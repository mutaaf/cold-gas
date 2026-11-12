# The forge's Blender entry (0211). Runs headless:
#   blender -b --factory-startup -P tools/forge/blender/run.py -- <job.json>
# The job (written by tools/forge/forge.mjs or brief.mjs) names an archetype (a trusted module in archetypes/) or a
# generated script (checked here before it runs: only the kit, no imports but math, no file or system access), the
# seed, the slot's spec (its physics box from the sim) and the budgets. It writes <out>/model.glb, turntable.png and
# report.json. Exit code 0 = built (the Node gate then judges the report), 2 = the build or the script check failed.
import ast
import importlib.util
import json
import math
import os
import random
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(os.path.dirname(HERE), 'archetypes'))   # archetypes share _car.py

import bpy  # noqa: E402
import forgekit  # noqa: E402
import finish  # noqa: E402
import turntable  # noqa: E402

SAFE_BUILTINS = {k: __builtins__[k] if isinstance(__builtins__, dict) else getattr(__builtins__, k) for k in (
    'range', 'len', 'min', 'max', 'abs', 'round', 'enumerate', 'zip', 'list', 'tuple', 'dict', 'set', 'float', 'int',
    'sum', 'sorted', 'reversed', 'print', 'ValueError', 'isinstance', 'bool', 'map', 'any', 'all', 'pow', 'divmod')}
FORBIDDEN_NAMES = {'open', 'exec', 'eval', 'compile', 'getattr', 'setattr', 'delattr', 'globals', 'locals', 'vars',
                   'input', 'breakpoint', '__import__', 'bpy', 'os', 'sys', 'subprocess', 'bmesh', 'mathutils', 'type',
                   'object', 'super', 'memoryview', 'bytearray', 'bytes', 'help', 'dir', 'id', 'hash', 'iter', 'next',
                   '__builtins__', '__import__', '__loader__', '__spec__'}


# Every attribute a script may touch, by name: the kit's public methods, a part's name, the seeded rng's draws, math, and
# the plain list/dict methods. An allowlist, not a blocklist: no frame, generator or class attribute leads out of the kit
# (gi_frame.f_back would reach run.py's globals), and the kit's own state (flags, parts) can't be rewritten.
KIT_METHODS = {n for n in dir(forgekit.Kit) if not n.startswith('_') and callable(getattr(forgekit.Kit, n))}
ALLOWED_ATTRS = KIT_METHODS | {'name'} | {'random', 'uniform', 'choice', 'randint', 'randrange', 'gauss'} | \
    {n for n in dir(math) if not n.startswith('_')} | {'append', 'extend', 'insert', 'pop', 'items', 'keys', 'values', 'get', 'index', 'count', 'reverse', 'sort', 'copy'}


def check_script(src):
    """A generated script may only call the kit. Returns a list of problems (empty = allowed)."""
    problems = []
    try:
        tree = ast.parse(src)
    except SyntaxError as e:
        return [f'syntax error: {e}']
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            names = [a.name for a in node.names] if isinstance(node, ast.Import) else [node.module or '']
            if any(n != 'math' for n in names):
                problems.append(f'line {node.lineno}: only `import math` is allowed (got {names})')
        elif isinstance(node, ast.Name) and node.id in FORBIDDEN_NAMES:
            problems.append(f'line {node.lineno}: `{node.id}` is not available in a forge script')
        elif isinstance(node, ast.Attribute) and node.attr not in ALLOWED_ATTRS:
            problems.append(f'line {node.lineno}: `.{node.attr}` is not part of the kit (scripts may call kit methods, rng draws and math only)')
        elif isinstance(node, (ast.Global, ast.Nonlocal, ast.With, ast.AsyncFunctionDef, ast.ClassDef, ast.Try, ast.Yield, ast.YieldFrom, ast.GeneratorExp, ast.Await)):
            problems.append(f'line {node.lineno}: {type(node).__name__} is not allowed')
        elif isinstance(node, ast.Constant) and isinstance(node.value, str) and len(node.value) > 64:
            problems.append(f'line {node.lineno}: long string literals are not allowed (no text in a model)')
        elif isinstance(node, (ast.While,)):
            problems.append(f'line {node.lineno}: while loops are not allowed (use for … in range)')
    if not any(isinstance(n, ast.FunctionDef) and n.name == 'build' for n in tree.body):
        problems.append('the script must define build(kit, spec, rng)')
    return problems


def load_build(job):
    if job.get('archetype'):
        path = os.path.join(os.path.dirname(HERE), 'archetypes', job['archetype'] + '.py')
        spec = importlib.util.spec_from_file_location('arch_' + job['archetype'], path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod.build, None
    src = open(job['script'], encoding='utf-8').read()
    problems = check_script(src)
    if problems:
        return None, problems
    ns = {'__builtins__': SAFE_BUILTINS, 'math': math}
    code = compile(src, 'forge-script', 'exec')
    # `import math` inside the script resolves through __import__, which the sandbox lacks: give it math only
    SAFE_BUILTINS['__import__'] = lambda name, *a, **k: math if name == 'math' else (_ for _ in ()).throw(ImportError(name))
    exec(code, ns)
    return ns['build'], None


def _dbg(obj, tag):
    if os.environ.get('FORGE_DEBUG'):
        from collections import Counter
        print('DBG', tag, len(obj.data.materials), obj.data.has_custom_normals, obj.data.attributes.get('keep_n') is not None)


def main():
    job = json.load(open(sys.argv[sys.argv.index('--') + 1], encoding='utf-8'))
    out = job['out']
    os.makedirs(out, exist_ok=True)
    report = {'id': job['id'], 'seed': job['seed'], 'source': job.get('archetype') or os.path.basename(job.get('script', '')), 'ok': False}
    t0 = time.time()
    try:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        # one thread: a build must give the same bytes every time (packing and decimation order depend on it)
        bpy.context.scene.render.threads_mode = 'FIXED'
        bpy.context.scene.render.threads = 1
        build, problems = load_build(job)
        if problems:
            report['scriptProblems'] = problems
            raise ValueError('script check failed')
        spec = job['spec']
        kit = forgekit.Kit(spec, seed=job['seed'], paint=tuple(job.get('paintLinear') or forgekit.PALETTE['paint'][0]))
        rng = random.Random(job['seed'])
        build(kit, spec, rng)
        flags = list(kit.flags)
        obj = finish.merge_all(kit, 'LOD0')
        _dbg(obj, 'merged')
        finish.unwrap(obj)
        _dbg(obj, 'unwrapped')
        if not os.environ.get('FORGE_NOWN'):
            finish.weighted_normals(obj)
        _dbg(obj, 'wn')
        report['ao'] = finish.bake_ao(obj, job['seed'], reach=job.get('aoReach', 0.7))
        report['lod0'] = finish.validate(obj, spec, job['kind'])
        report['outlineFlags'] = flags
        lods = [obj]
        for i, budget in enumerate(job['budgets'][1:], start=1):
            # a full copy here: tools/forge/lib/pack.mjs simplifies it to its budget (meshoptimizer: the same triangles
            # every run, where Blender's decimate varies by a few)
            lod = finish.make_lod(obj, 10 ** 9, f'LOD{i}')
            lods.append(lod)
            report[f'lod{i}'] = {'tris': finish.tris(lod), 'budget': budget}
        root_extras = {'id': job['id'], 'slot': job.get('slot'), 'seed': job['seed'], 'kind': job['kind'],
                       'lods': [finish.tris(o) for o in lods], 'source': report['source']}
        finish.export(lods, os.path.join(out, 'raw.glb'), root_extras)
        # after the export: the turntable wires the baked occlusion into the materials, which the glTF must not carry
        if job.get('turntable', True):
            turntable.render(obj, os.path.join(out, 'turntable.png'))
        report['ok'] = True
    except Exception as e:  # the report carries the failure; the Node side prints it
        report['error'] = f'{type(e).__name__}: {e}'
        report['trace'] = traceback.format_exc()[-2000:]
    report['seconds'] = round(time.time() - t0, 2)
    json.dump(report, open(os.path.join(out, 'report.json'), 'w'), indent=1)
    print('FORGE-REPORT', json.dumps({k: report.get(k) for k in ('ok', 'error', 'seconds')}))
    sys.exit(0 if report['ok'] else 2)


main()

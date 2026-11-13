// 0221: the HUD layouts live in the save beside everything else. A save from before them decodes with the factory
// controls; one with them keeps them through an encode; a damaged HUD field costs only itself, never the medals.
import Foundation
import Testing
@testable import ColdGasClient
import ColdGasLayout

@Suite struct HudSaves {
    func save(_ json: String) -> SaveData { SaveData.decode(Data(json.utf8)) }

    @Test func aSaveFromBeforeTheEditorHasTheFactoryControls() {
        let s = save(#"{"initials":"MUT","medals":{"show:pro":91.3},"settings":{"hand":"left"}}"#)
        #expect(s.hud == nil)
        #expect(s.hudPrefs == HudPrefs())
        #expect(s.hudPrefs.custom(.pro, .phone) == nil)
        // The old hand setting starts the left-handed mirror where nothing is saved for the shape.
        #expect(s.hudPrefs.custom(.pro, .phone, leftHanded: s.resolvedSettings.handedness == .left)?.preset == .leftHanded)
    }

    @Test func layoutsSurviveTheRoundTrip() throws {
        var s = SaveData()
        s.initials = "ABC"
        var h = HudPrefs()
        h.set(HudCustom([.slotA: HudPlacement(x: 0.2, y: 0.8, scale: 1.3, alpha: 0.7)]), .advanced, .duoTabletop)
        h.set(HudCustom(preset: .minimal), .drive, .tablet)
        h.sensitivity = 1.5; h.releaseOnLift = true; h.boostToggle = true; h.lookSensitivity = 2
        s.hud = h
        let back = SaveData.decode(s.encoded())
        #expect(back == s)
        #expect(back.hudPrefs.custom(.advanced, .duoTabletop)?.placements[.slotA]?.scale == 1.3)
        #expect(back.hudPrefs.custom(.drive, .tablet)?.preset == .minimal)
        #expect(back.hudPrefs.sens == 1.5 && back.hudPrefs.releasesOnLift && back.hudPrefs.boostToggles && !back.hudPrefs.brakeToggles)
    }

    @Test func aDamagedHudFieldCostsOnlyItself() {
        let s = save(#"{"medals":{"wall:pro":88},"hud":[1,2]}"#)
        #expect(s.medals == ["wall:pro": 88])
        #expect(s.hudPrefs == HudPrefs())
        let t = save(#"{"initials":"ABC","hud":{"sensitivity":9,"layouts":{"pro/phone":{"placements":{"slotB":{"x":0.5,"y":0.25,"scale":5,"alpha":-1}}}}}}"#)
        #expect(t.cleanedInitials == "ABC")
        #expect(t.hudPrefs.sens == 2)
        let p = t.hudPrefs.custom(.pro, .phone)?.placements[.slotB]
        #expect(p?.scale == 1.8 && p?.alpha == 0.15)
    }
}

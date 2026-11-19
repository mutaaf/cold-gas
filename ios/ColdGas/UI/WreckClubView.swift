// Wreck Club (0242): the rank, the paints it unlocks and every feat with how to earn it. Earned by play on this device: no
// accounts, nothing to buy, nothing that expires. A paint is the only thing a rank changes, and only the car's colour.
import SwiftUI
import ColdGasClient

struct WreckClubView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var book = SaveStore.shared.data.club ?? WreckClub.Book()
    var body: some View {
        VStack(spacing: 0) {
            SheetBar(name: "Wreck Club", close: { dismiss() })
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    rank
                    paints
                    feats
                }
                .padding(.horizontal, 20).padding(.vertical, 12)
            }
        }
        .onAppear { PerfCenter.shared.note(.club) }   // 0300: a flag in the session's feature use
    }
    private var rank: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(book.rank.name.uppercased()).font(Theme.marquee(22, .title2)).tracking(1.5).foregroundStyle(Theme.ink)
                .accessibilityIdentifier("club-rank")
            HStack(spacing: 6) {
                ForEach(WreckClub.ranks.indices, id: \.self) { i in
                    Capsule().fill(i <= book.rankIndex ? Theme.hot : Theme.hair).frame(height: 3)
                }
            }
            Text(book.next.map { "\(book.count) of \(WreckClub.feats.count) feats \u{B7} \($0.more) more to \($0.rank.name)" } ?? "Every feat. The lot is yours.")
                .font(Theme.text(13)).foregroundStyle(Theme.ink2)
        }
        .accessibilityElement(children: .combine)
    }
    private var paints: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("PAINT").font(Theme.text(10, .medium)).tracking(1.6).foregroundStyle(Theme.ink3)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: 10)], alignment: .leading, spacing: 10) {
                ForEach(WreckClub.paints, id: \.id) { p in swatch(p) }
            }
        }
    }
    private func swatch(_ p: WreckClub.Paint) -> some View {
        let open = book.unlocked(p), on = book.currentPaint.id == p.id
        return Button {
            guard open else { return }
            UISelectionFeedbackGenerator().selectionChanged()
            book.paint = p.id
            let b = book
            SaveStore.shared.update { $0.club = b }
            Game.shared.paintChanged()
        } label: {
            VStack(spacing: 6) {
                Circle().fill(p.isFactory ? AnyShapeStyle(LinearGradient(colors: [Theme.ink2, Theme.ink3], startPoint: .top, endPoint: .bottom))
                                          : AnyShapeStyle(Color(red: Double(p.r), green: Double(p.g), blue: Double(p.b))))
                    .frame(width: 34, height: 34)
                    .overlay(Circle().strokeBorder(on ? Theme.ink : Theme.hair, lineWidth: on ? 2 : 1))
                    .overlay { if !open { Image(systemName: "lock.fill").font(.system(size: 11)).foregroundStyle(Theme.ink) } }
                    .opacity(open ? 1 : 0.4)
                Text(open ? p.name : WreckClub.ranks[min(p.rank, WreckClub.ranks.count - 1)].name)
                    .font(Theme.text(11)).foregroundStyle(open ? Theme.ink2 : Theme.ink3).lineLimit(1).minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity, minHeight: 64).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(open ? p.name : "\(p.name), locked until \(WreckClub.ranks[min(p.rank, WreckClub.ranks.count - 1)].name)")
        .accessibilityAddTraits(on ? .isSelected : [])
    }
    private var feats: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("FEATS").font(Theme.text(10, .medium)).tracking(1.6).foregroundStyle(Theme.ink3).padding(.bottom, 6)
            ForEach(WreckClub.feats, id: \.id) { f in
                let got = book.feats[f.id] != nil
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Image(systemName: got ? "checkmark.circle.fill" : "circle").font(.system(size: 14))
                        .foregroundStyle(got ? Theme.hot : Theme.ink3)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(f.name).font(Theme.text(15, .medium)).foregroundStyle(got ? Theme.ink : Theme.ink2)
                        Text(f.how).font(Theme.text(12)).foregroundStyle(Theme.ink3).fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.vertical, 10)
                .overlay(alignment: .bottom) { Rectangle().fill(Theme.hair2).frame(height: 1) }
                .accessibilityElement(children: .combine)
                .accessibilityValue(got ? "Earned" : "Not yet")
            }
        }
    }
}

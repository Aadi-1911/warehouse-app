// Placeholder for the four dashboard pages whose real content is separate future tasks
// (Orders / Low stock / Parties / History — 07_UI_DESIGN_BRIEF.md §8 specifies all four).
//
// A named, honest placeholder rather than an empty route: the nav links are real and clickable by
// design, so landing on a blank pane would read as a bug. Saying which page this is and that it
// isn't built yet is the difference between "broken" and "not here yet".
export default function ComingSoon({ title, note }) {
  return (
    <div className="dash-card dash-coming-soon">
      <h2 className="dash-coming-soon-title">{title}</h2>
      <p className="dash-coming-soon-note">{note}</p>
    </div>
  );
}

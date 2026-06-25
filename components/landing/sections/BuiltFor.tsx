import { BUILT_FOR } from "../data"

export function BuiltFor() {
  return (
    <div className="builtfor-band">
      <div className="wrap">
        <div className="builtfor reveal" id="builtfor">
          <span className="bf-lead">Built for Life Sciences</span>
          <ul className="bf-list">
            {BUILT_FOR.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

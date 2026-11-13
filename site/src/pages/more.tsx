// More (phones): the four steps with their real progress, the pages to look things up in, appearance, and the way out.
import { PhoneNav, useBooks } from '../app.tsx';
import { CHECK, FLOW, LOOKUP, useProgress } from '../guide.tsx';
import { href, useTheme } from '../lib/hooks.ts';
import { Group, Icon, Row, Segmented } from '../ui.tsx';

export function More() {
  const books = useBooks();
  const report = books.status === 'ready' ? books.report : undefined;
  const p = useProgress(report);
  const [theme, toggleTheme] = useTheme();
  return (
    <>
      <PhoneNav />
      <div className="pscroll">
        <div className="large-head">
          <h1 className="large-title">More</h1>
        </div>
        <Group title={`Steps · ${p.count} of ${FLOW.length} done`}>
          {FLOW.map((s) => (
            <Row key={s.page} href={href(s.page)}>
              <span className="row-glyph">
                <Icon name={s.icon} size={20} />
              </span>
              <span className="row-main">{s.title}</span>
              {s.page === 'questions' && p.open > 0 && <span className="row-value num pencil">{p.open} open</span>}
              {p.done[s.page] && <span className="row-value ok">✓</span>}
            </Row>
          ))}
        </Group>
        <Group title="Look things up">
          {[...LOOKUP, CHECK].map((s) => (
            <Row key={s.page} href={href(s.page)}>
              <span className="row-glyph">
                <Icon name={s.icon} size={20} />
              </span>
              <span className="row-main">{s.title}</span>
            </Row>
          ))}
        </Group>
        <Group title="Appearance">
          <div className="row appearance-row">
            <span className="row-main">Theme</span>
            <Segmented<'light' | 'dark'>
              label="Theme"
              value={theme}
              onChange={(v) => v !== theme && toggleTheme()}
              options={[
                ['light', 'Light'],
                ['dark', 'Dark'],
              ]}
            />
          </div>
        </Group>
        <Group title="Tickmark">
          <Row href="#/">
            <span className="row-glyph">
              <Icon name="home" size={20} />
            </span>
            <span className="row-main">All treasuries</span>
          </Row>
          <Row href={href('welcome')}>
            <span className="row-glyph">
              <Icon name="info" size={20} />
            </span>
            <span className="row-main">How Tickmark works</span>
          </Row>
          <Row href="https://github.com/04-John/Tickmark">
            <span className="row-glyph">
              <Icon name="external" size={20} />
            </span>
            <span className="row-main">Source code</span>
          </Row>
        </Group>
      </div>
    </>
  );
}

import pageBkg from "@assets/landing_page/bkg.png";
import hcLogo from "@assets/landing_page/HC_logo.png";
import titleImg from "@assets/landing_page/title.png";
import {
  HCB_URL,
  HACKATIME_URL,
  SLACK_FAQ_URL,
  SLACK_HELP_URL,
} from "../constants/externalLinks.js";
import { SlackChannels } from "./SlackChannels.jsx";
import "./RulesPage.css";
import "./RulesPage.mobile.css";

export function RulesPage() {
  return (
    <main className="rules-page" aria-label="Venture project ship rules">
      <img className="rules-page__background" src={pageBkg} alt="" aria-hidden="true" />

      <header className="rules-page__top">
        <a href="/" aria-label="Back to Venture home">
          <img className="rules-page__logo" src={hcLogo} width={281} height={158} alt="Hack Club" />
        </a>
        <nav className="rules-page__top-nav" aria-label="Rules page">
          <a href="/">Home</a>
          <a href={SLACK_FAQ_URL} target="_blank" rel="noopener noreferrer">
            FAQ
          </a>
          <a href="/#slack">Slack</a>
        </nav>
      </header>

      <section className="rules-page__content">
        <header className="rules-page__header">
          <h1>Project Ship Rules</h1>
        </header>

        <nav className="rules-page__index" aria-label="Rules index">
          <a href="#project-type">Project Type</a>
          <a href="#journaling">Journaling System</a>
          <a href="#ship-requirements">Ship Requirements</a>
          <a href="#rules">Rules</a>
          <a href="#questions">Questions</a>
        </nav>

        <section className="rules-page__card rules-page__theme">
          <h2>Theme Required</h2>
          <p>
            Your project must be <strong>adventure-related</strong>. <strong>Software</strong>,{" "}
            <strong>hardware</strong>, or <strong>art</strong> that supports{" "}
            <strong>travel and exploration</strong> counts. See the landing page for examples.
          </p>
        </section>

        <section id="project-type" className="rules-page__card">
          <h2>Project Type</h2>
          <div className="rules-page__grid">
            <article>
              <h3>Base Project</h3>
              <ul>
                <li>
                  <strong className="rules-page__project-kw">Software</strong>: track time with{" "}
                  <a href={HACKATIME_URL} target="_blank" rel="noreferrer">
                    Hackatime
                  </a>
                  . If setup is broken, ask for help in <strong>Hack Club Slack</strong>.
                </li>
                <li>
                  <strong className="rules-page__project-kw">Hardware</strong>: track time with the{" "}
                  <a href="#journaling">journaling system</a> and/or{" "}
                  <a href="https://lapse.hackclub.com/" target="_blank" rel="noreferrer">
                    Lapse
                  </a>
                  .
                </li>
              </ul>
              <p className="rules-page__callout">
                If the tool you are using supports{" "}
                <a href={HACKATIME_URL} target="_blank" rel="noreferrer">
                  Hackatime
                </a>
                , you{" "}
                <strong>
                  must use{" "}
                  <a href={HACKATIME_URL} target="_blank" rel="noreferrer">
                    Hackatime
                  </a>
                </strong>
                . For example, you cannot track{" "}
                <strong>VS Code</strong> work only with{" "}
                <a href="https://lapse.hackclub.com/" target="_blank" rel="noreferrer">
                  Lapse
                </a>{" "}
                or <a href="#journaling">journaling</a>.
              </p>
            </article>
            <article>
              <h3>Optional Base Project Add-on</h3>
              <p>
                <strong className="rules-page__project-kw">Art</strong> can count for up to an additional{" "}
                <strong>25%</strong> of your
                base project hours, tracked with the <strong>journaling system</strong>.
              </p>
              <p>
                Example: if your non-art base project is <strong>10 hours</strong>, you can add up
                to <strong>1.5 hours</strong> of related art work, for{" "}
                <strong>11.5 countable hours</strong> total.
              </p>
            </article>
          </div>
        </section>

        <section className="rules-page__card">
          <h2>What Counts As Art?</h2>
          <p>
            Art should be a <strong>meaningful plus</strong> to your existing base project.
            Reviewers judge based on quality and whether the work is clearly related to{" "}
            <strong>travel</strong>, <strong>exploration</strong>, or <strong>navigation</strong>.
          </p>
          <div className="rules-page__table-wrap">
            <table className="rules-page__table">
              <thead>
                <tr>
                  <th>ART examples</th>
                  <th>Hardware examples</th>
                  <th>Not-shippable</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Blender or 3D modeling only</td>
                  <td>PCB design</td>
                  <td>Google research for your project</td>
                </tr>
                <tr>
                  <td>Assets, music, drawings, Figma, Video editing</td>
                  <td>CAD/3D modeling associated with a hardware component*</td>
                  <td>Random external work unrelated to the project</td>
                </tr>
                <tr>
                  <td>Anything that includes design only</td>
                  <td>Schematics</td>
                  <td>General planning or browsing</td>
                </tr>
              </tbody>
            </table>
          </div>
          <aside className="rules-page__footnote" aria-label="CAD and 3D modeling note">
            <p>
              * CAD/3D modeling is not considered as art only if you associate that to a hardware
              project. Eg. if you&apos;re 3D modeling a Raspberry case, that will be considered as
              non-art only if you ship some hardware with it (like a PCB schematic). Otherwise, the
              case only, is just art.
            </p>
          </aside>
          <p className="rules-page__callout">
            Not sure if your add-on art will count? Ask first in the Venture{" "}
            <a href={SLACK_HELP_URL} target="_blank" rel="noopener noreferrer">
              Slack help channel
            </a>
            .
          </p>
        </section>

        <section id="journaling" className="rules-page__card">
          <h2>Journaling System</h2>
          <ul className="rules-page__checklist">
            <li>
              Take <strong>photos or screenshots</strong> of your improvements.
            </li>
            <li>
              Record quick <strong>update videos</strong> when helpful (optional).
            </li>
            <li>
              Write a <strong>brief description</strong> of what changed.
            </li>
            <li>
              Do this for each new feature, ideally around <strong>every hour</strong> of work.
            </li>
            <li>
              Put your work and proof into your <strong>GitHub commits</strong>.
            </li>
          </ul>
          <p>
            Log entries from the <strong>Journal</strong> button on any project in the Venture
            platform. Upload media via <strong>#cdn</strong> on Slack, then paste the link into your
            entry description.
          </p>
        </section>

        <section id="ship-requirements" className="rules-page__card">
          <h2>Ship Requirements</h2>
          <p>
            Find the full list and explanation{" "}
            <a
              href="https://hackclub.gitbook.io/ysws-project-submission-guidelines/BLBRN8LIfoCZhFV6oMNR/required-submission-fields"
              target="_blank"
              rel="noreferrer"
            >
              here
            </a>
            .
          </p>
          <ul className="rules-page__checklist">
            <li>
              <strong>GitHub open-source</strong> page with <strong>frequent commits</strong>,
              around every <strong>30 minutes to 1 hour</strong> of coding.
            </li>
            <li>
              <strong>Mandatory tracking system</strong>.
            </li>
            <li>
              <strong>Working live demo</strong>.
            </li>
          </ul>
          <p className="rules-page__callout">
            You earn <strong>travel credits</strong> for approved hours. Activity logged before the{" "}
            <strong>official event start</strong> does <strong>not count</strong> unless an
            organizer gave <strong>written permission</strong>.
          </p>
        </section>

        <section id="rules" className="rules-page__card">
          <h2>Rules</h2>
          <ul className="rules-page__checklist">
            <li>
              You must be <strong>13–18 years old</strong> to participate.
            </li>
            <li>
              <strong>AI</strong> is allowed only as support, with a max of{" "}
              <strong>30% of the codebase</strong>.
            </li>
            <li>
              <strong>No double-dipping</strong> with other programs.
            </li>
            <li>
              <strong>No fraud</strong>. Do not cheat the tracking system: no bots, fake key
              presses, or UI manipulation.               Violations can result in bans from{" "}
              <a href={HACKATIME_URL} target="_blank" rel="noreferrer">
                <strong>Hackatime</strong>
              </a>{" "}
              and other <strong>YSWS programs</strong>.
            </li>
          </ul>
        </section>

        <section id="questions" className="rules-page__card rules-page__help">
          <h2>Still Have Questions?</h2>
          <p>
            Ask in the <strong>Venture Slack channels</strong> below, or read the quick <strong>FAQ</strong> there.
          </p>
          <a href={SLACK_FAQ_URL} target="_blank" rel="noopener noreferrer">
            Open FAQ
          </a>
        </section>

        <SlackChannels />
      </section>

      <a className="rules-page__back" href="/" aria-label="Back to home">
        ← Back home
      </a>
      <a className="rules-page__brand" href="/" aria-label="Venture home">
        <img src={titleImg} width={1011} height={560} alt="Venture" />
      </a>
    </main>
  );
}

import pageBkg from "@assets/landing_page/bkg.png";
import hcLogo from "@assets/landing_page/HC_logo.png";
import titleImg from "@assets/landing_page/title.png";
import characters from "@assets/landing_page/icons/characters.png";
import tentIcon from "@assets/landing_page/icons/tent_icon.png";
import rosewindIcon from "@assets/landing_page/icons/rosewind_icon.png";
import pisaIcon from "@assets/landing_page/icons/pisa_icon.png";
import trackIcon from "@assets/landing_page/icons/track_icon.png";
import mountainIcon from "@assets/landing_page/icons/mountain_icon.png";
import "./Hero.css";
import "./Hero.mobile.css";
import "./RsvpPage.css";

const RSVP_URL = "https://rsvp.hackclub.community/ship4trip";
const SLACK_CHANNEL_URL =
  "https://app.slack.com/client/E09V59WQY1E/C0C2X6470BV";

const YOU_SHIP_ITEMS = [
  "A Project about an Amazing Place",
  "Public transit app",
  "Travel game",
  "Offline GPS PCB",
  "An interactive map",
  "Website to find cool local spots",
  '"Pack for your trip" tool',
];

const WE_SHIP_ITEMS = [
  "Flight tickets",
  "Event tickets",
  "Travel gear",
  "Hotel credits",
  "Transport tickets",
];

const FAQ_ITEMS = [
  {
    question: "What is this?",
    answer: (
      <>
        <strong>Software</strong>, <strong>hardware</strong> or <strong>art</strong>. Anything that
        helps an adventurer <strong>navigate</strong>, <strong>discover</strong>, and{" "}
        <strong>enjoy</strong> their <strong>journey</strong>! Build it, ship it, and earn travel
        credits.
      </>
    ),
  },
  {
    question: "What are the rules?",
    answer: (
      <>
        You must be <strong>13-18 years old</strong> to participate. Projects should be related to{" "}
        <strong>exploration and travel</strong>. Ship something that follows the rules, and
        you&apos;re set!
      </>
    ),
  },
  {
    question: "How do I receive my prize?",
    answer: (
      <>
        After a reviewer approves your project, you&apos;ll receive a virtual{" "}
        <a href="https://hcb.hackclub.com/" target="_blank" rel="noreferrer">
          <strong>HCB prepaid card</strong>
        </a>
        .
      </>
    ),
  },
];

export function RsvpPage() {
  return (
    <section className="hero" aria-label="Ship4Trip RSVP">
      <img
        className="hero__page-bkg"
        src={pageBkg}
        alt=""
        aria-hidden="true"
        width={2107}
        height={7465}
      />

      {/* -- Section 1: Hero -- */}
      <div className="hero__shell">
        <header className="hero__header">
          <a
            href="https://hackclub.com"
            aria-label="Go to Hack Club"
            target="_blank"
            rel="noopener noreferrer"
          >
            <img className="hero__brand" src={hcLogo} width={281} height={158} alt="Hack Club" />
          </a>
        </header>

        <div className="hero__main">
          

          <div className="hero__copy">
            <h1 className="hero__headline">Don&apos;t scroll it...go see it!</h1>
            <p className="hero__tagline">
              Build projects related to <strong>Amazing Places</strong>. Earn{" "}
              <strong>travel credits</strong> like <strong>flight tickets</strong>,{" "}
              <strong>events</strong>, and <strong>hotels</strong> for your{" "}
              <strong>Trip to said place</strong>.
            </p>
            <div className="hero__join-wrap">
              <a
                className="rsvp__btn"
                href={RSVP_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="RSVP now"
              >
                RSVP NOW
              </a>
              <a
                className="rsvp__slack-link"
                href={SLACK_CHANNEL_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Join the Slack channel
              </a>
            </div>
          </div>
          <img
            className="hero__characters"
            src={characters}
            width={1068}
            height={883}
            alt="Adventure characters"
          />
        </div>

        <div className="hero__icons" aria-hidden="true">
          <img className="hero__icon hero__icon--track" src={trackIcon} alt="" />
        </div>
      </div>

      {/* -- Section 2: You Ship / We Ship -- */}
      <section className="section-ship" aria-labelledby="rsvp-you-ship-heading">
        <div className="section-ship__row section-ship__row--top">
          <img
            className="section-ship__tent"
            src={tentIcon}
            width={977}
            height={531}
            alt=""
            aria-hidden="true"
          />
          <div className="section-ship__list-wrap">
            <h2 id="rsvp-you-ship-heading" className="section-ship__heading">
              You Ship:
            </h2>
            <ul className="section-ship__list">
              {YOU_SHIP_ITEMS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className="section-ship__row section-ship__row--bottom">
          <div className="section-ship__list-wrap">
            <h2 className="section-ship__heading">We Ship:</h2>
            <ul className="section-ship__list">
              {WE_SHIP_ITEMS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <div className="hero__lower">
        {/* -- Section 3: FAQ -- */}
        <section id="faq" className="section-faq" aria-labelledby="rsvp-faq-heading">
          <img
            className="section-faq__mountain"
            src={mountainIcon}
            width={1589}
            height={662}
            alt=""
            aria-hidden="true"
          />
          <h2 id="rsvp-faq-heading" className="section-faq__heading-text">
            FAQ
          </h2>
          <dl className="section-faq__list">
            {FAQ_ITEMS.map(({ question, answer }) => (
              <div key={question} className="section-faq__item">
                <dt>{question}</dt>
                <dd>{answer}</dd>
              </div>
            ))}
          </dl>
          <div className="section-faq__icons-row" aria-hidden="true">
            <img className="section-whats__icon section-whats__icon--rosewind" src={rosewindIcon} alt="" />
            <img className="section-whats__icon section-whats__icon--pisa" src={pisaIcon} alt="" />
          </div>
        </section>

        {/* -- Section 4: CTA Footer -- */}
        <section className="rsvp__footer" aria-label="Sign up">
          <h2 className="rsvp__footer-heading">Ready to explore?</h2>
          <p className="rsvp__footer-text">
            RSVP now and join the Slack channel to stay in the loop.
          </p>
          <div className="rsvp__footer-actions">
            <a
              className="rsvp__btn"
              href={RSVP_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              RSVP NOW
            </a>
            <a
              className="rsvp__slack-link"
              href={SLACK_CHANNEL_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Join the Slack channel
            </a>
          </div>
        </section>
      </div>
    </section>
  );
}

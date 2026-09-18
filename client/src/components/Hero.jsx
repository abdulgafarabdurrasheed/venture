import pageBkg from "@assets/landing_page/bkg.png";
import hcLogo from "@assets/landing_page/HC_logo.png";
import titleImg from "@assets/landing_page/title.png";
import joinBtn from "@assets/landing_page/join_btn.png";
import travelBlock from "@assets/landing_page/travel_block.png";
import eventsBlock from "@assets/landing_page/events_block.png";
import hcBlock from "@assets/landing_page/hc_block.png";
import characters from "@assets/landing_page/icons/characters.png";
import tentIcon from "@assets/landing_page/icons/tent_icon.png";
import block1 from "@assets/landing_page/1_block.png";
import block2 from "@assets/landing_page/2_block.png";
import block3 from "@assets/landing_page/3_block.png";
import faqTitle from "@assets/landing_page/FAQ_titel.png";
import mountainIcon from "@assets/landing_page/icons/mountain_icon.png";
import mapIcon from "@assets/landing_page/icons/map_icon.png";
import slackTitle from "@assets/landing_page/slack_title.png";
import helpBlock from "@assets/landing_page/help_block.png";
import newsBlock from "@assets/landing_page/news_block.png";
import chatBlock from "@assets/landing_page/chat_block.png";
import trackIcon from "@assets/landing_page/icons/track_icon.png";
import pisaIcon from "@assets/landing_page/icons/pisa_icon.png";
import rosewindIcon from "@assets/landing_page/icons/rosewind_icon.png";
import { useEffect, useState } from "react";
import {
  HCB_URL,
  SLACK_CHAT_URL,
  SLACK_FAQ_URL,
  SLACK_HELP_URL,
  SLACK_NEWS_URL,
} from "../constants/externalLinks.js";
import { ShopCarousel } from "./ShopCarousel.jsx";
import "./Hero.css";
import "./Hero.mobile.css";

const YOU_SHIP_ITEMS = [
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
    question: "What are the rules?",
    answer: (
      <>
        You must be <strong>13–18 years old</strong> to participate. Projects should be related to{" "}
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
        <a href={HCB_URL} target="_blank" rel="noreferrer">
          <strong>HCB prepaid card</strong>
        </a>
        .
      </>
    ),
  },
  {
    question: "When will Off-Track end?",
    answer: (
      <>
        Off-Track runs from <strong>June 15 to July 15</strong>. Dates are subject to change.
      </>
    ),
  },
];

export function Hero() {
  const [authError, setAuthError] = useState("");
  const isLocalDev = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const joinHref = isLocalDev
    ? "/projects"
    : "/api/auth/hackclub/login?returnTo=/projects";
  const authErrorMessages = {
    oauth_config: "Login is not configured. Contact the organizers.",
    oauth_denied: "Login was cancelled.",
    oauth_callback: "Login failed. Please try again.",
    database_missing: "Local database is missing. Run: createdb -U postgres off-track_local",
    database_not_configured: "DATABASE_URL is not set in .env",
    dev_signup: "Signup failed. Check the server logs.",
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const errorCode = params.get("auth_error");
    if (errorCode) {
      setAuthError(authErrorMessages[errorCode] || "Signup failed. Try again.");
      params.delete("auth_error");
      const nextQuery = params.toString();
      const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`;
      window.history.replaceState({}, "", nextUrl);
    }
  }, []);

  return (
    <section className="hero" aria-label="Off Track landing">
      <img
        className="hero__page-bkg"
        src={pageBkg}
        alt=""
        aria-hidden="true"
        width={2107}
        height={7465}
      />

      {/* —— Section 1: Hero —— */}
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

          <nav className="hero__nav" aria-label="Primary">
            <a href="https://hackclub.com" target="_blank" rel="noopener noreferrer">
              Hack Club
            </a>
            <a href="/rules">Rules</a>
            <a href={SLACK_FAQ_URL} target="_blank" rel="noopener noreferrer">
              FAQ
            </a>
            <a href="#slack">Slack</a>
            <a href="#shop">Shop</a>
          </nav>
        </header>

        <div className="hero__main">
          <div className="hero__title-wrap">
            <img className="hero__title" src={titleImg} width={1011} height={560} alt="Off-Track" />
            <p className="hero__dates" aria-label="Program dates">
              June 15th - July 15th
            </p>
          </div>

          <div className="hero__copy">
            <h1 className="hero__headline">Don&apos;t scroll it...go see it!</h1>
            <p className="hero__tagline">
              Build projects related to <strong>explore and travel</strong>. Earn{" "}
              <strong>travel credits</strong> like <strong>flight tickets</strong>,{" "}
              <strong>events</strong>, and <strong>hotels</strong> for your{" "}
              <strong>next adventure</strong>.
            </p>
            <div className="hero__join-wrap">
              {authError ? <p className="hero__auth-error">{authError}</p> : null}
              <a
                className="hero__join"
                href={joinHref}
                aria-label="Join now"
              >
                <img src={joinBtn} width={461} height={127} alt="" />
              </a>
            </div>
          </div>
        </div>

        <div className="hero__icons" aria-hidden="true">
          <img className="hero__icon hero__icon--track" src={trackIcon} alt="" />
        </div>
      </div>

      {/* —— Section 2: What's this? —— */}
      <section className="section-whats" aria-labelledby="whats-heading">
        <div className="section-whats__intro">
          <div className="section-whats__copy">
            <h2 id="whats-heading" className="section-whats__heading">
              What&apos;s this?
            </h2>
            <p className="section-whats__text">
              <strong>Software</strong>, <strong>hardware</strong> or <strong>art</strong>. Anything that
              helps an adventurer <strong>navigate</strong>, <strong>discover</strong>, and{" "}
              <strong>enjoy</strong> their <strong>journey</strong>!
            </p>
          </div>
          <div className="section-whats__icons" aria-hidden="true">
            <img className="section-whats__icon section-whats__icon--rosewind" src={rosewindIcon} alt="" />
            <img className="section-whats__icon section-whats__icon--pisa" src={pisaIcon} alt="" />
          </div>
        </div>
        <div className="section-whats__gallery">
          <img src={travelBlock} width={745} height={480} alt="Travel projects" />
          <img src={eventsBlock} width={777} height={480} alt="Events projects" />
          <img src={hcBlock} width={745} height={480} alt="Hack Club community" />
        </div>
      </section>

      {/* —— Section 3: You Ship / We Ship —— */}
      <section className="section-ship" aria-labelledby="you-ship-heading">
        <div className="section-ship__row section-ship__row--top">
          <img
            className="section-ship__characters"
            src={characters}
            width={1068}
            height={883}
            alt="Off-Track characters"
          />
          <div className="section-ship__list-wrap">
            <h2 id="you-ship-heading" className="section-ship__heading">
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
          <img
            className="section-ship__tent"
            src={tentIcon}
            width={977}
            height={531}
            alt=""
            aria-hidden="true"
          />
        </div>
      </section>

      <ShopCarousel />

      <div className="hero__lower">
        {/* —— Section 4: How it works —— */}
        <section className="section-how" aria-label="How it works">
          <div className="section-how__steps">
            <img src={block1} width={1027} height={737} alt="Step 1: Sign up and join Slack channels" />
            <img src={block2} width={1049} height={649} alt="Step 2: Log your building hours" />
            <img src={block3} width={1015} height={719} alt="Step 3: Get rewards from the shop" />
          </div>
        </section>

        {/* —— Section 5: FAQ —— */}
        <section id="faq" className="section-faq" aria-labelledby="faq-heading">
        <img
          className="section-faq__mountain"
          src={mountainIcon}
          width={1589}
          height={662}
          alt=""
          aria-hidden="true"
        />
        <img
          className="section-faq__title-img"
          src={faqTitle}
          width={1287}
          height={430}
          alt=""
          aria-hidden="true"
        />
        <h2 id="faq-heading" className="section-faq__sr-heading">
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
        <a className="section-faq__more" href="/rules">
          Read full rules &amp; FAQs here...
        </a>
        <img
          className="section-faq__map"
          src={mapIcon}
          width={408}
          height={369}
          alt=""
          aria-hidden="true"
        />
      </section>

        {/* —— Section 6: Slack footer —— */}
        <section id="slack" className="section-slack" aria-labelledby="slack-heading">
        <img
          className="section-slack__title"
          src={slackTitle}
          width={742}
          height={227}
          alt="Slack"
        />
        <h2 id="slack-heading" className="section-slack__sr-heading">
          Slack channels
        </h2>
        <div className="section-slack__blocks">
          <a
            href={SLACK_HELP_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Help channel"
          >
            <img src={helpBlock} width={819} height={538} alt="Help" />
          </a>
          <a
            href={SLACK_NEWS_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="News channel"
          >
            <img src={newsBlock} width={819} height={538} alt="News" />
          </a>
          <a
            href={SLACK_CHAT_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Chat channel"
          >
            <img src={chatBlock} width={819} height={538} alt="Chat" />
          </a>
        </div>
        </section>
      </div>
    </section>
  );
}

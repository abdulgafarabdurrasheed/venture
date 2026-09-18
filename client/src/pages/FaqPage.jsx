import helpBlock from "@assets/landing_page/help_block.png";
import newsBlock from "@assets/landing_page/news_block.png";
import chatBlock from "@assets/landing_page/chat_block.png";
import faqBlock from "@assets/common_to_pages/help_block.png";
import rulesBlock from "@assets/common_to_pages/news_block.png";
import slackIcon from "@assets/common_to_pages/Slack_icon.png";
import {
  SLACK_CHAT_URL,
  SLACK_FAQ_URL,
  SLACK_HELP_URL,
  SLACK_NEWS_URL,
} from "../constants/externalLinks.js";
import { PlatformLayout } from "../platform/PlatformLayout.jsx";
import "./FaqPage.css";

const INFO_LINKS = [
  { href: SLACK_HELP_URL, image: helpBlock, label: "Help" },
  { href: SLACK_NEWS_URL, image: newsBlock, label: "News" },
  { href: SLACK_CHAT_URL, image: chatBlock, label: "Chat" },
  { href: SLACK_FAQ_URL, image: faqBlock, label: "FAQ" },
  { href: "/rules", image: rulesBlock, label: "Rules" },
];

export function FaqPage() {
  return (
    <PlatformLayout activeTab="info" contentClassName="platform-frame__content--info">
      <div className="info-page">
        <div className="info-page__scrolls">
          <div className="info-page__row">
            {INFO_LINKS.slice(0, 3).map((link) => (
              <a
                key={link.label}
                className="info-page__scroll-link"
                href={link.href}
                target={link.href.startsWith("http") ? "_blank" : undefined}
                rel={link.href.startsWith("http") ? "noopener noreferrer" : undefined}
              >
                <img src={link.image} alt={link.label} draggable={false} />
              </a>
            ))}
          </div>
          <div className="info-page__row">
            {INFO_LINKS.slice(3).map((link) => (
              <a
                key={link.label}
                className="info-page__scroll-link"
                href={link.href}
                target={link.href.startsWith("http") ? "_blank" : undefined}
                rel={link.href.startsWith("http") ? "noopener noreferrer" : undefined}
              >
                <img src={link.image} alt={link.label} draggable={false} />
              </a>
            ))}
          </div>
        </div>

        <img className="info-page__slack" src={slackIcon} alt="" aria-hidden="true" />
      </div>
    </PlatformLayout>
  );
}

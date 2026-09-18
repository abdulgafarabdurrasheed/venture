import {
  SLACK_CHAT_URL,
  SLACK_HELP_URL,
  SLACK_NEWS_URL,
} from "../constants/externalLinks.js";
import "./SlackChannels.css";

export function SlackChannels({ className = "" }) {
  return (
    <section
      className={`offtrack-slack-channels ${className}`.trim()}
      aria-labelledby="slack-channels-heading"
    >
      <h2 id="slack-channels-heading">Slack Channels</h2>
      <div className="offtrack-slack-channels__links">
        <a href={SLACK_HELP_URL} target="_blank" rel="noopener noreferrer">
          Help
        </a>
        <a href={SLACK_NEWS_URL} target="_blank" rel="noopener noreferrer">
          News
        </a>
        <a href={SLACK_CHAT_URL} target="_blank" rel="noopener noreferrer">
          Chat
        </a>
      </div>
    </section>
  );
}

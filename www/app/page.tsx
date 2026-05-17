import { MessageCircle, Search, Split } from "lucide-react";
import content from "./content.json";

const featureIcons = {
  search: Search,
  message: MessageCircle,
  split: Split
};

const fastTabNumber = process.env.NEXT_PUBLIC_FASTTAB_PHONE ?? content.cta.phone;
const formattedFastTabNumber =
  process.env.NEXT_PUBLIC_FASTTAB_PHONE_DISPLAY ?? content.cta.phoneDisplay;
const smsBody = encodeURIComponent(content.cta.body);

export default function Home() {
  const smsHref = `sms:${fastTabNumber}?&body=${smsBody}`;

  return (
    <main className="site-shell">
      <header className="site-header">
        <a href="/">{content.siteTitle}</a>
        <a className="header-cta" href={smsHref}>
          Order Now: {formattedFastTabNumber}
        </a>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <h1 id="hero-title">{content.heroTitle}</h1>
        <p className="subtitle">
          <a href={smsHref}>{content.subtitle.linkText}</a>
          {content.subtitle.after}
        </p>

        <div className="chat" aria-label="Example iMessage exchange">
          {content.messages.map((message, index) => (
            <div
              className={`bubble ${message.side === "right" ? "right" : "left"}`}
              key={`${message.speaker}-${message.text}`}
              style={{ animationDelay: `${index * 0.75}s` }}
            >
              <span>{message.speaker}</span>
              {message.text}
            </div>
          ))}
        </div>

        <div className="cta-row">
          <a className="primary-cta" href={smsHref}>
            Text {formattedFastTabNumber} to Order
          </a>
          <span className="cta-note">{content.cta.note}</span>
        </div>
      </section>

      <section className="details" aria-label="FastTab features">
        <div className="feature-grid">
          <span className="grid-plus plus-top-start" aria-hidden="true">+</span>
          <span className="grid-plus plus-top-one" aria-hidden="true">+</span>
          <span className="grid-plus plus-top-two" aria-hidden="true">+</span>
          <span className="grid-plus plus-top-end" aria-hidden="true">+</span>
          <span className="grid-plus plus-bottom-start" aria-hidden="true">+</span>
          <span className="grid-plus plus-bottom-one" aria-hidden="true">+</span>
          <span className="grid-plus plus-bottom-two" aria-hidden="true">+</span>
          <span className="grid-plus plus-bottom-end" aria-hidden="true">+</span>
          {content.features.map((feature) => {
            const Icon =
              featureIcons[feature.icon as keyof typeof featureIcons] ?? Search;

            return (
              <article className={`feature-card ${feature.icon}`} key={feature.title}>
                <div className="feature-icon" aria-hidden="true">
                  <Icon size={20} strokeWidth={2.1} />
                </div>
                <h2>{feature.title}</h2>
                <p>{feature.body}</p>
              </article>
            );
          })}
        </div>

        <div className="stats-grid" aria-label="FastTab stats">
          {content.stats.map((stat) => (
            <div className="stat-card" key={stat.label}>
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
            </div>
          ))}
        </div>
      </section>

      <footer className="site-footer">
        <div>
          <p className="hackathon-line">
            {content.footer.hackathon.beforeLogo}
            <span className="yc-logo" aria-label="Y Combinator">Y</span>
            {content.footer.hackathon.afterLogo}
          </p>
          <p className="copyright">{content.footer.copyright}</p>
        </div>
        <nav aria-label="Footer links">
          {content.footer.links.map((link) => (
            <a
              href={link.href === "sms" ? smsHref : link.href}
              key={link.label}
            >
              {link.label}
            </a>
          ))}
        </nav>
      </footer>
    </main>
  );
}

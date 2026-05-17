import content from "./content.json";

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
    </main>
  );
}

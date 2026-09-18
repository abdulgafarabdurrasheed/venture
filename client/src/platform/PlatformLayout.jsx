import singleBkg from "@assets/common_to_pages/single_bkg.png";
import frameBkg from "@assets/common_to_pages/bkg_frame.png";
import prjTab from "@assets/common_to_pages/prj_tab.png";
import shopTab from "@assets/common_to_pages/shop_tab.png";
import userTab from "@assets/common_to_pages/user_tab.png";
import infoTab from "@assets/common_to_pages/info_tab.png";
import nextBtn from "@assets/common_to_pages/next_btn.png";
import { PlatformProfileBar } from "./PlatformProfileBar.jsx";
import "./PlatformLayout.css";

export const PLATFORM_TABS = [
  { id: "projects", href: "/projects", label: "Projects", image: prjTab },
  { id: "shop", href: "/shop", label: "Shop", image: shopTab },
  { id: "user", href: "/user", label: "User", image: userTab },
  { id: "info", href: "/faq", label: "Info", image: infoTab },
];

export function PlatformLayout({
  activeTab,
  children,
  contentClassName = "",
  onNext,
  showNext = false,
  nextLabel = "Next page",
  onPrev,
  showPrev = false,
  prevLabel = "Previous page",
}) {
  return (
    <div className="platform-layout">
      <img className="platform-layout__page-bkg" src={singleBkg} alt="" aria-hidden="true" />
      <PlatformProfileBar />

      <div className="platform-layout__panel">
        <nav className="platform-tabs" aria-label="Platform sections">
          {PLATFORM_TABS.map((tab) => {
            const isActive = tab.id === activeTab;
            return (
              <a
                key={tab.id}
                href={tab.href}
                className={`platform-tab${isActive ? " platform-tab--active" : ""}`}
                aria-current={isActive ? "page" : undefined}
              >
                <img src={tab.image} alt={tab.label} draggable={false} />
              </a>
            );
          })}
        </nav>

        <section className="platform-frame" aria-label="Page content">
          <img className="platform-frame__bkg" src={frameBkg} alt="" aria-hidden="true" />
          <div className={`platform-frame__content${contentClassName ? ` ${contentClassName}` : ""}`}>
            {children}
          </div>

          {showPrev ? (
            <button type="button" className="platform-frame__prev" onClick={onPrev} aria-label={prevLabel}>
              <img src={nextBtn} alt="" draggable={false} />
            </button>
          ) : null}

          {showNext ? (
            <button type="button" className="platform-frame__next" onClick={onNext} aria-label={nextLabel}>
              <img src={nextBtn} alt="" draggable={false} />
            </button>
          ) : null}
        </section>
      </div>
    </div>
  );
}

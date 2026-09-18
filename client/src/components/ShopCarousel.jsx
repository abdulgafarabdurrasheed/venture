import { useEffect, useRef } from "react";
import shopFrame from "@assets/landing_page/shop_section/shopFrame.png";
import shopTitle from "@assets/landing_page/shop_section/shop_title.png";
import adventureGears from "@assets/landing_page/shop_section/items/adventure_gears.png";
import bags from "@assets/landing_page/shop_section/items/bags.png";
import busTickets from "@assets/landing_page/shop_section/items/bus_tickets.png";
import culturalTickets from "@assets/landing_page/shop_section/items/cultural_tickets.png";
import eventTickets from "@assets/landing_page/shop_section/items/event_tickets.png";
import flightTickets from "@assets/landing_page/shop_section/items/flight_tickets.png";
import hotels from "@assets/landing_page/shop_section/items/hotels.png";
import passport from "@assets/landing_page/shop_section/items/passport.png";
import trainTickets from "@assets/landing_page/shop_section/items/train_tickets.png";
import visa from "@assets/landing_page/shop_section/items/visa.png";
import "./ShopCarousel.css";
import "./ShopCarousel.mobile.css";

const SHOP_ITEMS = [
  { name: "Flight Tickets", image: flightTickets },
  { name: "Passport", image: passport },
  { name: "Visa", image: visa },
  { name: "Adventure Gears", image: adventureGears },
  { name: "Bags", image: bags },
  { name: "Bus Tickets", image: busTickets },
  { name: "Cultural Tickets", image: culturalTickets },
  { name: "Event Tickets", image: eventTickets },
  { name: "Hotels", image: hotels },
  { name: "Train Tickets", image: trainTickets },
];

const LOOP_ITEMS = [...SHOP_ITEMS, ...SHOP_ITEMS];

function ShopItemName({ name }) {
  const words = name.trim().split(/\s+/);

  if (words.length === 2) {
    return (
      <p className="section-shop__name">
        <span className="section-shop__name-line">{words[0]}</span>
        <span className="section-shop__name-line">{words[1]}</span>
      </p>
    );
  }

  return <p className="section-shop__name">{name}</p>;
}

export function ShopCarousel() {
  const sectionRef = useRef(null);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return undefined;

    let timeoutId;
    const onScroll = () => {
      section.classList.add("section-shop--scroll-pause");
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        section.classList.remove("section-shop--scroll-pause");
      }, 150);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.clearTimeout(timeoutId);
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      id="shop"
      className="section-shop"
      aria-labelledby="shop-heading"
    >
      <div className="section-shop__inner">
        <img
          id="shop-heading"
          className="section-shop__title"
          src={shopTitle}
          width={1111}
          height={253}
          alt="Shop"
        />
        <div className="section-shop__carousel" aria-label="Shop items carousel">
          <div className="section-shop__track">
            {LOOP_ITEMS.map((item, index) => (
              <article
                key={`${item.name}-${index}`}
                className="section-shop__card"
                aria-label={item.name}
              >
                <div className="section-shop__frame">
                  <img
                    className="section-shop__frame-img"
                    src={shopFrame}
                    width={1289}
                    height={1908}
                    alt=""
                    aria-hidden="true"
                  />
                  <img
                    className="section-shop__item-img"
                    src={item.image}
                    alt=""
                    aria-hidden="true"
                  />
                  <div className="section-shop__label">
                    <ShopItemName name={item.name} />
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

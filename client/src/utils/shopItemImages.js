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

const SHOP_ITEM_IMAGES = {
  "adventure gears": adventureGears,
  "exploring gears": adventureGears,
  bags,
  "bus tickets": busTickets,
  "cultural tickets": culturalTickets,
  "event tickets": eventTickets,
  "flight ticket": flightTickets,
  "flight tickets": flightTickets,
  hotels,
  passport,
  "train tickets": trainTickets,
  visa,
};

export function resolveShopItemImage(item) {
  if (item?.imageUrl) return item.imageUrl;

  const key = String(item?.name || "")
    .trim()
    .toLowerCase();
  return SHOP_ITEM_IMAGES[key] || adventureGears;
}

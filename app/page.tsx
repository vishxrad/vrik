"use client";

import { useState } from "react";
import {
  BadgeIndianRupee,
  Bell,
  Bike,
  Check,
  ChevronRight,
  Clock3,
  Compass,
  Gift,
  Headphones,
  HelpCircle,
  History,
  Home,
  IndianRupee,
  MapPin,
  MessageCircle,
  Navigation,
  PackageCheck,
  Phone,
  Power,
  ReceiptText,
  ShieldCheck,
  Star,
  Store,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";

type Tab = "home" | "earnings" | "history" | "support";

const navItems = [
  { id: "home" as const, label: "Home", icon: Home },
  { id: "earnings" as const, label: "Earnings", icon: WalletCards },
  { id: "history" as const, label: "History", icon: History },
  { id: "support" as const, label: "Support", icon: Headphones },
];

const orderStages = [
  {
    eyebrow: "NEW ORDER",
    title: "Head to the restaurant",
    subtitle: "Pickup is 1.8 km away",
    action: "I’m at the restaurant",
  },
  {
    eyebrow: "AT PICKUP",
    title: "Collect order #4821",
    subtitle: "Ask for the order at the counter",
    action: "Order picked up",
  },
  {
    eyebrow: "ON THE WAY",
    title: "Deliver to Ananya",
    subtitle: "Customer is 3.2 km away",
    action: "Mark as delivered",
  },
  {
    eyebrow: "DELIVERED",
    title: "Nice work, Ram!",
    subtitle: "₹62 has been added to your earnings",
    action: "Find next order",
  },
];

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [online, setOnline] = useState(true);
  const [orderStage, setOrderStage] = useState(0);
  const [toast, setToast] = useState("");

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  };

  const advanceOrder = () => {
    if (orderStage === 3) {
      setOrderStage(0);
      notify("Searching for a nearby order…");
      return;
    }
    setOrderStage((stage) => stage + 1);
    notify(
      orderStage === 2
        ? "Delivery completed — ₹62 earned"
        : "Order status updated",
    );
  };

  return (
    <main className="site-shell">
      <section className="phone-app" aria-label="Zomato delivery partner demo">
        <header className="app-header">
          <div className="top-row">
            <div className="wordmark" aria-label="Zomato delivery partner">
              <span>zomato</span>
              <small>delivery partner</small>
            </div>
            <div className="header-actions">
              <button
                className="icon-button light"
                onClick={() => notify("You’re all caught up")}
                aria-label="Notifications"
              >
                <Bell size={20} strokeWidth={2.3} />
                <i aria-hidden="true" />
              </button>
              <button
                className="avatar"
                onClick={() => notify("Profile preview")}
                aria-label="Open Ram Kumar's profile"
              >
                RK
              </button>
            </div>
          </div>

          <div className="welcome-row">
            <div>
              <p>Good evening, Ram</p>
              <h1>{online ? "Ready to deliver?" : "You’re offline"}</h1>
            </div>
            <button
              className={`online-toggle ${online ? "is-online" : ""}`}
              onClick={() => {
                setOnline((value) => !value);
                notify(online ? "You are now offline" : "You are now online");
              }}
              aria-pressed={online}
            >
              <Power size={17} strokeWidth={2.5} />
              {online ? "ONLINE" : "GO ONLINE"}
            </button>
          </div>
        </header>

        <div className="floating-summary" aria-label="Today's delivery summary">
          <div className="summary-item">
            <span className="summary-icon red">
              <IndianRupee size={18} />
            </span>
            <div>
              <strong>₹842</strong>
              <small>Today’s earnings</small>
            </div>
          </div>
          <div className="summary-divider" />
          <div className="summary-item">
            <span className="summary-icon green">
              <PackageCheck size={18} />
            </span>
            <div>
              <strong>12</strong>
              <small>Orders delivered</small>
            </div>
          </div>
        </div>

        <div className="app-content">
          {activeTab === "home" && (
            <HomeView
              online={online}
              orderStage={orderStage}
              onAdvance={advanceOrder}
              onNotify={notify}
            />
          )}
          {activeTab === "earnings" && <EarningsView />}
          {activeTab === "history" && <HistoryView />}
          {activeTab === "support" && <SupportView onNotify={notify} />}
        </div>

        <nav className="bottom-nav" aria-label="Main navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                className={isActive ? "active" : ""}
                onClick={() => setActiveTab(item.id)}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon size={21} strokeWidth={isActive ? 2.7 : 2} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {toast && (
          <div className="toast" role="status">
            <Check size={17} />
            {toast}
            <button onClick={() => setToast("")} aria-label="Dismiss message">
              <X size={15} />
            </button>
          </div>
        )}
      </section>

      <aside className="desktop-note" aria-label="Demo information">
        <div className="note-badge">
          <Bike size={18} />
          RIDER DEMO
        </div>
        <h2>A familiar delivery flow, ready for your voice layer.</h2>
        <p>
          This standalone dummy mirrors a practical food-delivery partner app.
          It intentionally contains no translator, voice agent, or backend
          integration yet.
        </p>
        <div className="demo-checks">
          <span><Check size={16} /> Mobile-first delivery UI</span>
          <span><Check size={16} /> Clickable order progression</span>
          <span><Check size={16} /> Earnings, history and support tabs</span>
        </div>
      </aside>
    </main>
  );
}

function HomeView({
  online,
  orderStage,
  onAdvance,
  onNotify,
}: {
  online: boolean;
  orderStage: number;
  onAdvance: () => void;
  onNotify: (message: string) => void;
}) {
  const stage = orderStages[orderStage];
  const isDelivered = orderStage === 3;

  return (
    <div className="view-stack">
      {!online && (
        <button className="offline-card" onClick={() => onNotify("Use the toggle above to go online")}> 
          <span><Power size={19} /></span>
          <div>
            <strong>Go online to receive orders</strong>
            <small>You won’t get new delivery requests while offline.</small>
          </div>
          <ChevronRight size={19} />
        </button>
      )}

      <section className={`order-card ${isDelivered ? "complete" : ""}`}>
        <div className="order-card-top">
          <div>
            <span className="order-label">{stage.eyebrow}</span>
            <h2>{stage.title}</h2>
            <p>{stage.subtitle}</p>
          </div>
          <div className="eta-badge">
            {isDelivered ? <Check size={21} /> : <><strong>{orderStage === 2 ? "12" : "7"}</strong><small>MIN</small></>}
          </div>
        </div>

        <div className="order-id-row">
          <span>ORDER #4821</span>
          <span><Clock3 size={14} /> Pickup by 8:42 PM</span>
        </div>

        <div className="route-list">
          <div className="route-rail" aria-hidden="true">
            <span className={orderStage >= 1 ? "done" : "current"} />
            <i className={orderStage >= 2 ? "done" : ""} />
            <span className={orderStage >= 3 ? "done" : ""} />
          </div>
          <div className="route-stop">
            <div>
              <small>PICKUP</small>
              <strong>Empire Restaurant</strong>
              <p>Church Street, Ashok Nagar</p>
            </div>
            <button onClick={() => onNotify("Calling restaurant…")} aria-label="Call Empire Restaurant">
              <Phone size={18} />
            </button>
          </div>
          <div className="route-stop">
            <div>
              <small>DELIVER TO</small>
              <strong>Ananya • Home</strong>
              <p>Tower C, Indiranagar</p>
            </div>
            <button onClick={() => onNotify("Calling customer…")} aria-label="Call customer Ananya">
              <Phone size={18} />
            </button>
          </div>
        </div>

        <div className="order-actions">
          <button className="secondary-action" onClick={() => onNotify("Opening directions…")}>
            <Navigation size={18} /> Directions
          </button>
          <button className="primary-action" onClick={onAdvance}>
            {isDelivered ? <Bike size={19} /> : <MapPin size={19} />}
            {stage.action}
          </button>
        </div>
      </section>

      <button className="incentive-card" onClick={() => onNotify("2 more orders to unlock your bonus")}> 
        <div className="gift-icon"><Gift size={22} /></div>
        <div className="incentive-copy">
          <span>EVENING QUEST</span>
          <strong>Earn ₹120 extra</strong>
          <small>Complete 2 more orders before 10 PM</small>
          <div className="progress-track"><i /></div>
        </div>
        <ChevronRight size={19} />
      </button>

      <div className="quick-actions">
        <h3>Quick actions</h3>
        <div className="quick-grid">
          <button onClick={() => onNotify("Availability settings opened")}>
            <span><Clock3 size={20} /></span>
            <strong>Set availability</strong>
            <small>Plan your shift</small>
          </button>
          <button onClick={() => onNotify("Safety centre opened")}>
            <span><ShieldCheck size={20} /></span>
            <strong>Safety centre</strong>
            <small>Help on the road</small>
          </button>
        </div>
      </div>
    </div>
  );
}

function EarningsView() {
  const bars = [44, 68, 52, 88, 74, 96, 62];
  const days = ["M", "T", "W", "T", "F", "S", "S"];

  return (
    <div className="view-stack section-view">
      <div className="section-heading">
        <span><BadgeIndianRupee size={20} /></span>
        <div><small>WEEKLY SUMMARY</small><h2>Your earnings</h2></div>
      </div>
      <section className="earnings-hero">
        <p>This week</p>
        <h3>₹4,860</h3>
        <span>↑ 12% from last week</span>
        <div className="chart" aria-label="Earnings chart for this week">
          {bars.map((height, index) => (
            <div className="bar-column" key={`${days[index]}-${index}`}>
              <i style={{ height: `${height}%` }} className={index === 5 ? "peak" : ""} />
              <small>{days[index]}</small>
            </div>
          ))}
        </div>
      </section>
      <section className="stats-grid">
        <div><IndianRupee size={20} /><small>Order pay</small><strong>₹3,720</strong></div>
        <div><Gift size={20} /><small>Incentives</small><strong>₹940</strong></div>
        <div><Star size={20} /><small>Tips</small><strong>₹200</strong></div>
        <div><ReceiptText size={20} /><small>Orders</small><strong>68</strong></div>
      </section>
      <button className="list-link"><span><WalletCards size={20} /> Payment history</span><ChevronRight size={19} /></button>
      <button className="list-link"><span><HelpCircle size={20} /> Earnings help</span><ChevronRight size={19} /></button>
    </div>
  );
}

function HistoryView() {
  const orders = [
    { time: "7:48 PM", place: "Meghana Foods", area: "Koramangala", amount: "₹58" },
    { time: "6:55 PM", place: "Truffles", area: "Indiranagar", amount: "₹71" },
    { time: "5:32 PM", place: "A2B Veg", area: "Domlur", amount: "₹49" },
    { time: "4:18 PM", place: "Leon Grill", area: "MG Road", amount: "₹64" },
  ];
  return (
    <div className="view-stack section-view">
      <div className="section-heading">
        <span><History size={20} /></span>
        <div><small>SUNDAY, 9 AUG</small><h2>Order history</h2></div>
      </div>
      <div className="history-summary">
        <div><strong>12</strong><small>Completed</small></div>
        <div><strong>6h 24m</strong><small>Online time</small></div>
        <div><strong>₹842</strong><small>Earned</small></div>
      </div>
      <section className="history-list">
        {orders.map((order, index) => (
          <article key={order.time}>
            <span className="store-icon"><Store size={19} /></span>
            <div><small>{order.time} • Order #{4809 - index * 7}</small><strong>{order.place}</strong><p>Delivered to {order.area}</p></div>
            <b>{order.amount}</b>
          </article>
        ))}
      </section>
    </div>
  );
}

function SupportView({ onNotify }: { onNotify: (message: string) => void }) {
  const items = [
    { icon: ReceiptText, title: "Current order issue", copy: "Pickup, customer or delivery help" },
    { icon: IndianRupee, title: "Payments & earnings", copy: "Payouts, incentives and tips" },
    { icon: UserRound, title: "Profile & account", copy: "Documents and account settings" },
    { icon: Compass, title: "Vehicle & app help", copy: "Navigation or technical support" },
  ];
  return (
    <div className="view-stack section-view">
      <div className="section-heading">
        <span><Headphones size={20} /></span>
        <div><small>WE’RE HERE TO HELP</small><h2>Partner support</h2></div>
      </div>
      <button className="urgent-help" onClick={() => onNotify("Connecting you to support…")}>
        <span><MessageCircle size={22} /></span>
        <div><strong>Need help with this order?</strong><small>Get priority support for order #4821</small></div>
        <ChevronRight size={20} />
      </button>
      <section className="support-list">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.title} onClick={() => onNotify(`${item.title} opened`)}>
              <span><Icon size={20} /></span>
              <div><strong>{item.title}</strong><small>{item.copy}</small></div>
              <ChevronRight size={19} />
            </button>
          );
        })}
      </section>
      <div className="safety-note"><ShieldCheck size={20} /><p><strong>Emergency on the road?</strong><small>Use the SOS option in Safety centre.</small></p></div>
    </div>
  );
}

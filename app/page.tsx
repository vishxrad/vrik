"use client";

import { useState } from "react";
import {
  BadgeIndianRupee,
  Bell,
  Bike,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Gift,
  Headphones,
  History,
  Home,
  IndianRupee,
  MessageCircle,
  Navigation,
  PackageCheck,
  Phone,
  ReceiptText,
  ShieldCheck,
  Star,
  Store,
  UserRound,
  Wallet,
  X,
} from "lucide-react";

import { LocalTranslation } from "@/components/local-translation";
import { RiderCallbackCall } from "@/components/callback/rider-callback-call";
import { SupportAgentCall } from "@/components/support-agent-call";

type Tab = "home" | "earnings" | "history" | "support";

const navItems = [
  { id: "home" as const, label: "Home", icon: Home },
  { id: "earnings" as const, label: "Earnings", icon: Wallet },
  { id: "history" as const, label: "History", icon: History },
  { id: "support" as const, label: "Support", icon: Headphones },
];

const orderStages = [
  {
    status: "Pickup",
    title: "Head to Empire Restaurant",
    message: "Pick up by 8:42 PM",
    action: "I’ve reached the restaurant",
  },
  {
    status: "At restaurant",
    title: "Collect order #4821",
    message: "2 items • Paid online",
    action: "I’ve picked up the order",
  },
  {
    status: "Delivery",
    title: "Deliver to Ananya",
    message: "Reach by 9:06 PM",
    action: "Complete delivery",
  },
  {
    status: "Delivered",
    title: "Order delivered",
    message: "₹62 added to today’s earnings",
    action: "Find another order",
  },
];

export default function DeliveryPartnerApp() {
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [online, setOnline] = useState(true);
  const [orderStage, setOrderStage] = useState(0);
  const [toast, setToast] = useState("");
  const [supportCallOpen, setSupportCallOpen] = useState(false);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  };

  const advanceOrder = () => {
    if (orderStage === 3) {
      setOrderStage(0);
      notify("Looking for orders near Indiranagar");
      return;
    }
    setOrderStage((stage) => stage + 1);
    notify(orderStage === 2 ? "Delivery completed" : "Order status updated");
  };

  return (
    <main className="preview-canvas">
      <section className="partner-app" aria-label="Zomato delivery partner demo">
        <AppHeader notify={notify} />

        <div className="partner-status">
          <div className="partner-status__copy">
            <span className={`status-dot ${online ? "online" : ""}`} />
            <div>
              <strong>{online ? "You’re online" : "You’re offline"}</strong>
              <small>{online ? "Finding orders near Indiranagar" : "Go online to receive orders"}</small>
            </div>
          </div>
          <button
            className={`sushi-switch ${online ? "selected" : ""}`}
            onClick={() => {
              setOnline((value) => !value);
              notify(online ? "You are now offline" : "You are now online");
            }}
            aria-label={online ? "Go offline" : "Go online"}
            aria-pressed={online}
          >
            <span />
          </button>
        </div>

        <div className="today-stats" aria-label="Today’s summary">
          <div><small>Today’s earnings</small><strong>₹842</strong></div>
          <div><small>Orders</small><strong>12</strong></div>
          <div><small>Online</small><strong>6h 24m</strong></div>
        </div>

        <div className="screen-content">
          {activeTab === "home" && (
            <HomeScreen
              online={online}
              orderStage={orderStage}
              onAdvance={advanceOrder}
              onNotify={notify}
              onOpenSupport={() => setSupportCallOpen(true)}
            />
          )}
          {activeTab === "earnings" && <EarningsScreen />}
          {activeTab === "history" && <HistoryScreen />}
          {activeTab === "support" && (
            <SupportScreen
              onNotify={notify}
              onOpenSupport={() => setSupportCallOpen(true)}
            />
          )}
        </div>

        <nav className="bottom-nav" aria-label="Main navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const current = activeTab === item.id;
            return (
              <button
                key={item.id}
                className={current ? "current" : ""}
                onClick={() => setActiveTab(item.id)}
                aria-current={current ? "page" : undefined}
              >
                <Icon size={22} strokeWidth={current ? 2.4 : 1.9} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {orderStage < 3 && <LocalTranslation />}
        <SupportAgentCall
          open={supportCallOpen}
          onClose={() => setSupportCallOpen(false)}
        />
        <RiderCallbackCall onIncoming={() => setSupportCallOpen(false)} />

        {toast && (
          <div className="sushi-toast" role="status">
            <Check size={17} />
            <span>{toast}</span>
            <button onClick={() => setToast("")} aria-label="Dismiss message">
              <X size={16} />
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

function AppHeader({ notify }: { notify: (message: string) => void }) {
  return (
    <header className="app-bar">
      <div className="brand-lockup" aria-label="Zomato partner">
        <span>zomato</span>
        <small>partner</small>
      </div>
      <button className="area-selector" onClick={() => notify("Delivery area opened")}>
        Indiranagar <ChevronDown size={15} />
      </button>
      <button className="app-bar__icon" onClick={() => notify("No new notifications")} aria-label="Notifications">
        <Bell size={21} />
        <span aria-hidden="true" />
      </button>
      <button className="profile-button" onClick={() => notify("Profile opened")} aria-label="Open Ram Kumar's profile">RK</button>
    </header>
  );
}

function HomeScreen({
  online,
  orderStage,
  onAdvance,
  onNotify,
  onOpenSupport,
}: {
  online: boolean;
  orderStage: number;
  onAdvance: () => void;
  onNotify: (message: string) => void;
  onOpenSupport: () => void;
}) {
  const stage = orderStages[orderStage];
  const delivered = orderStage === 3;

  return (
    <div className="screen-stack">
      {!online && (
        <button className="sushi-banner sushi-banner--warning" onClick={() => onNotify("Use the status switch to go online")}> 
          <CircleAlert size={20} />
          <span><strong>You’re not receiving orders</strong><small>Go online whenever you’re ready.</small></span>
          <ChevronRight size={18} />
        </button>
      )}

      <div className="section-title">
        <div><h1>Current order</h1><p>Order #4821</p></div>
        <span className={`status-chip ${delivered ? "success" : ""}`}>{stage.status}</span>
      </div>

      <section className="sushi-card order-card">
        <div className={`order-summary ${delivered ? "order-summary--success" : ""}`}>
          <div>
            <small>{stage.message}</small>
            <h2>{stage.title}</h2>
          </div>
          <div className="eta-value">
            {delivered ? <PackageCheck size={24} /> : <><strong>{orderStage === 2 ? "12" : "7"}</strong><small>min</small></>}
          </div>
        </div>

        <div className="route">
          <div className="route__markers" aria-hidden="true">
            <span className={orderStage >= 1 ? "complete" : "active"} />
            <i className={orderStage >= 2 ? "complete" : ""} />
            <span className={orderStage >= 3 ? "complete" : ""} />
          </div>
          <div className="route__stop">
            <small>Pickup from</small>
            <strong>Empire Restaurant</strong>
            <p>Church Street, Ashok Nagar</p>
          </div>
          <div className="route__stop">
            <small>Deliver to</small>
            <strong>Ananya • Home</strong>
            <p>Tower C, Indiranagar</p>
          </div>
        </div>

        <div className="order-meta">
          <span><Bike size={17} /> 5.0 km total</span>
          <span><BadgeIndianRupee size={17} /> Earn ₹62</span>
        </div>

        <div className="order-tools" aria-label="Order actions">
          <button onClick={() => onNotify("Calling restaurant")}><Phone size={19} /><span>Call</span></button>
          <button onClick={() => onNotify("Opening directions")}><Navigation size={19} /><span>Directions</span></button>
          <button onClick={onOpenSupport}><Headphones size={19} /><span>AI support</span></button>
        </div>

        <button className={`sushi-button sushi-button--primary ${delivered ? "sushi-button--success" : ""}`} onClick={onAdvance}>
          {stage.action}
        </button>
      </section>

      <button className="sushi-banner sushi-banner--reward" onClick={() => onNotify("Complete 2 more orders to unlock ₹120")}>
        <span className="banner-icon"><Gift size={21} /></span>
        <span><strong>Earn ₹120 extra tonight</strong><small>Complete 2 more orders before 10 PM</small></span>
        <ChevronRight size={19} />
      </button>

      <section className="home-links sushi-card">
        <button onClick={() => onNotify("Safety centre opened")}><ShieldCheck size={20} /><span><strong>Safety centre</strong><small>Emergency help and insurance</small></span><ChevronRight size={19} /></button>
        <button onClick={() => onNotify("Availability settings opened")}><Clock3 size={20} /><span><strong>Set availability</strong><small>Choose your working hours</small></span><ChevronRight size={19} /></button>
      </section>
    </div>
  );
}

function EarningsScreen() {
  const bars = [42, 64, 52, 74, 68, 92, 58];
  const days = ["M", "T", "W", "T", "F", "S", "S"];
  return (
    <div className="screen-stack">
      <div className="section-title"><div><h1>Earnings</h1><p>5–11 August</p></div></div>
      <section className="sushi-card earnings-card">
        <small>This week</small>
        <h2>₹4,860</h2>
        <p>₹522 more than last week</p>
        <div className="earnings-chart" aria-label="Weekly earnings chart">
          {bars.map((height, index) => (
            <div key={`${days[index]}-${index}`}><span><i style={{ height: `${height}%` }} className={index === 5 ? "highlight" : ""} /></span><small>{days[index]}</small></div>
          ))}
        </div>
      </section>
      <div className="earning-breakdown">
        <div className="sushi-card"><IndianRupee size={19} /><small>Order pay</small><strong>₹3,720</strong></div>
        <div className="sushi-card"><Gift size={19} /><small>Incentives</small><strong>₹940</strong></div>
        <div className="sushi-card"><Star size={19} /><small>Tips</small><strong>₹200</strong></div>
        <div className="sushi-card"><ReceiptText size={19} /><small>Orders</small><strong>68</strong></div>
      </div>
      <section className="home-links sushi-card">
        <button><Wallet size={20} /><span><strong>Payment history</strong><small>View payouts and withdrawals</small></span><ChevronRight size={19} /></button>
        <button><CircleAlert size={20} /><span><strong>Earnings help</strong><small>Report a payment issue</small></span><ChevronRight size={19} /></button>
      </section>
    </div>
  );
}

function HistoryScreen() {
  const orders = [
    { time: "7:48 PM", place: "Meghana Foods", area: "Koramangala", pay: "₹58" },
    { time: "6:55 PM", place: "Truffles", area: "Indiranagar", pay: "₹71" },
    { time: "5:32 PM", place: "A2B Veg", area: "Domlur", pay: "₹49" },
    { time: "4:18 PM", place: "Leon Grill", area: "MG Road", pay: "₹64" },
  ];
  return (
    <div className="screen-stack">
      <div className="section-title"><div><h1>Order history</h1><p>Sunday, 9 August</p></div></div>
      <div className="history-summary sushi-card">
        <div><strong>12</strong><small>Completed</small></div>
        <div><strong>6h 24m</strong><small>Online</small></div>
        <div><strong>₹842</strong><small>Earned</small></div>
      </div>
      <section className="order-history sushi-card">
        {orders.map((order, index) => (
          <article key={order.time}>
            <span className="row-icon"><Store size={19} /></span>
            <div><small>{order.time} • #{4809 - index * 7}</small><strong>{order.place}</strong><p>Delivered to {order.area}</p></div>
            <b>{order.pay}</b>
          </article>
        ))}
      </section>
    </div>
  );
}

function SupportScreen({
  onNotify,
  onOpenSupport,
}: {
  onNotify: (message: string) => void;
  onOpenSupport: () => void;
}) {
  const items = [
    { icon: ReceiptText, title: "Current order", copy: "Pickup, customer or delivery issue" },
    { icon: IndianRupee, title: "Payments and earnings", copy: "Payouts, incentives and tips" },
    { icon: UserRound, title: "Profile and account", copy: "Documents and account settings" },
    { icon: ShieldCheck, title: "Safety centre", copy: "SOS, insurance and emergency help" },
  ];
  return (
    <div className="screen-stack">
      <div className="section-title"><div><h1>Partner support</h1><p>Help is available 24×7</p></div></div>
      <button className="sushi-banner sushi-banner--support" onClick={onOpenSupport}>
        <span className="banner-icon"><MessageCircle size={21} /></span>
        <span><strong>Talk to AI support in Hindi</strong><small>Order #4821 is shared automatically</small></span>
        <ChevronRight size={19} />
      </button>
      <section className="home-links sushi-card">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.title} onClick={() => onNotify(`${item.title} opened`)}>
              <Icon size={20} /><span><strong>{item.title}</strong><small>{item.copy}</small></span><ChevronRight size={19} />
            </button>
          );
        })}
      </section>
      <div className="emergency-note"><ShieldCheck size={20} /><span><strong>Emergency on the road?</strong><small>Open Safety centre and use SOS.</small></span></div>
    </div>
  );
}

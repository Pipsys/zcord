import { motion } from "framer-motion";
import { Link, useLocation } from "react-router-dom";

import { Tooltip } from "@/components/ui/Tooltip";
import { useServerStore } from "@/store/serverStore";
import zcordLogo from "../../../animal.png";

const homeItemBase =
  "relative grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl text-sm font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-accent/35";
const serverItemBase =
  "relative grid h-[52px] w-[52px] shrink-0 place-items-center overflow-hidden rounded-2xl text-sm font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-accent/35";

export const Sidebar = () => {
  const location = useLocation();
  const routeServerId = location.pathname.startsWith("/app/server/") ? location.pathname.replace("/app/server/", "") : null;

  const servers = useServerStore((state) => state.servers);
  const activeServerId = useServerStore((state) => state.activeServerId);
  const setActiveServer = useServerStore((state) => state.setActiveServer);

  const homeActive = location.pathname.startsWith("/app/home");

  return (
    <aside className="flex h-full w-[72px] flex-col items-center gap-2 border-r border-black/35 bg-paw-bg-tertiary py-3">
      <Tooltip label="Home" side="right">
        <Link to="/app/home" onClick={() => setActiveServer(null)}>
          <motion.div
            className={homeItemBase}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            style={{ backgroundColor: homeActive ? "var(--color-accent-primary)" : "transparent", color: "var(--color-text-primary)" }}
          >
            <span className="grid h-12 w-12 place-items-center rounded-xl bg-black/20 p-1">
              <img src={zcordLogo} alt="zcord" className="block h-full w-full object-contain" />
            </span>
            {homeActive ? <span className="absolute -left-[11px] h-5 w-1 rounded-r-full bg-white" /> : null}
          </motion.div>
        </Link>
      </Tooltip>

      <div className="h-px w-8 bg-white/8" />

      <div className="flex flex-1 flex-col items-center gap-2 overflow-y-auto pb-2">
        {servers.map((server) => {
          const active = server.id === activeServerId || server.id === routeServerId;
          return (
            <Tooltip key={server.id} label={server.name} side="right">
              <Link to={`/app/server/${server.id}`} onClick={() => setActiveServer(server.id)}>
                <motion.div
                  className={serverItemBase}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  style={{ backgroundColor: active ? "var(--color-accent-primary)" : "var(--color-bg-secondary)", color: "var(--color-text-primary)" }}
                >
                  {active ? <span className="absolute -left-[11px] h-5 w-1 rounded-r-full bg-white" /> : null}
                  {server.icon_url ? (
                    <img src={server.icon_url} alt={server.name} className="block h-11 w-11 rounded-[14px] object-cover" />
                  ) : (
                    <span className="grid h-11 w-11 place-items-center rounded-[14px] bg-black/20 text-[13px] font-semibold">
                      {server.name.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                </motion.div>
              </Link>
            </Tooltip>
          );
        })}
      </div>
    </aside>
  );
};

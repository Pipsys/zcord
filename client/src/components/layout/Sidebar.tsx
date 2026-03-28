import { motion } from "framer-motion";
import { Link, useLocation } from "react-router-dom";

import { Tooltip } from "@/components/ui/Tooltip";
import { useServerStore } from "@/store/serverStore";
import rucordLogo from "../../../animal.png";

const itemBase = "relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl text-sm font-semibold transition";

export const Sidebar = () => {
  const location = useLocation();
  const routeServerId = location.pathname.startsWith("/app/server/") ? location.pathname.replace("/app/server/", "") : null;

  const servers = useServerStore((state) => state.servers);
  const activeServerId = useServerStore((state) => state.activeServerId);
  const setActiveServer = useServerStore((state) => state.setActiveServer);

  const homeActive = location.pathname.startsWith("/app/home");

  return (
    <aside className="flex h-full w-[72px] flex-col items-center gap-2 border-r border-white/10 bg-black/20 py-3 backdrop-blur-sm">
      <Tooltip label="Home" side="right">
        <Link to="/app/home" onClick={() => setActiveServer(null)}>
          <motion.div
            className={itemBase}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.97 }}
            style={{
              backgroundColor: homeActive ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.04)",
              border: homeActive ? "1px solid rgba(255,255,255,0.22)" : "1px solid rgba(255,255,255,0.10)",
              color: "var(--color-text-primary)",
            }}
          >
            <img src={rucordLogo} alt="Rucord" className="block h-6 w-6 rounded-lg object-contain" />
            {homeActive ? <span className="absolute -left-[11px] h-8 w-1 rounded-r bg-white" /> : null}
          </motion.div>
        </Link>
      </Tooltip>

      <div className="h-px w-8 bg-white/12" />

      <div className="flex flex-1 flex-col items-center gap-2 overflow-y-auto pb-2">
        {servers.map((server) => {
          const active = server.id === activeServerId || server.id === routeServerId;
          return (
            <Tooltip key={server.id} label={server.name} side="right">
              <Link to={`/app/server/${server.id}`} onClick={() => setActiveServer(server.id)}>
                <motion.div
                  className={itemBase}
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.97 }}
                  style={{
                    backgroundColor: active ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.04)",
                    border: active ? "1px solid rgba(255,255,255,0.22)" : "1px solid rgba(255,255,255,0.10)",
                    color: "var(--color-text-primary)",
                  }}
                >
                  {active ? <span className="absolute -left-[11px] h-8 w-1 rounded-r bg-white" /> : null}
                  {server.icon_url ? (
                    <img src={server.icon_url} alt={server.name} className="block h-10 w-10 rounded-xl object-cover" />
                  ) : (
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/8 text-[13px] font-semibold">
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

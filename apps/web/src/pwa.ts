/** Register the installable shell only in production builds; development stays free of service-worker cache state. */
export function registerPwaServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js", { scope: "/" });
  }, { once: true });
}

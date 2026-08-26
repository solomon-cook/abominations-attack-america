/** Register the installable shell only in production builds; development stays free of service-worker cache state. */
export function registerPwaServiceWorker(onUpdateAvailable: () => void): () => void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return () => undefined;
  let registration: ServiceWorkerRegistration | undefined;
  let disposed = false;
  const notifyIfWaiting = () => {
    if (!disposed && registration?.waiting) onUpdateAvailable();
  };
  const onControllerChange = () => window.location.reload();
  const onUpdateFound = () => {
    const worker = registration?.installing;
    if (!worker) return;
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed") notifyIfWaiting();
    });
  };
  navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).then((nextRegistration) => {
      if (disposed) return;
      registration = nextRegistration;
      registration.addEventListener("updatefound", onUpdateFound);
      notifyIfWaiting();
    });
  }, { once: true });
  return () => {
    disposed = true;
    navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    registration?.removeEventListener("updatefound", onUpdateFound);
  };
}

export async function activatePwaUpdate(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration();
  registration?.waiting?.postMessage({ type: "SKIP_WAITING" });
}

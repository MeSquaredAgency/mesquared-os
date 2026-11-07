/** Runs in the page head: keeps Chrome's install prompt for the install button, so an early event is never lost before React loads. */
export const CAPTURE_INSTALL_SCRIPT = `window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__msqInstall=e;});`;

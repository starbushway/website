// On small screens the main menu folds behind the "Menü" button.
const knopf = document.querySelector(".menue-knopf");
const menue = document.getElementById("hauptmenue");
if (knopf && menue) {
  knopf.addEventListener("click", () => {
    const offen = knopf.getAttribute("aria-expanded") === "true";
    knopf.setAttribute("aria-expanded", String(!offen));
    menue.classList.toggle("offen", !offen);
  });
}

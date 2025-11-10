// --- POC v2.8 demo logic ---
// This version uses only in-memory data (no backend yet).

const mockSets = [
  {
    title: "Et liv forbi",
    author: "Karin Fossum",
    faust: "12345678",
    isbn: "9788203369999",
    available: true,
    region: "Gentofte",
  },
  {
    title: "Den som blinker er bange for døden",
    author: "Knud Romer",
    faust: "87654321",
    isbn: "9788702057159",
    available: false,
    region: "Gentofte",
  },
];

document.getElementById("search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = document.getElementById("searchQuery").value.toLowerCase();
  const resultsDiv = document.getElementById("results");
  resultsDiv.innerHTML = "";

  const matches = mockSets.filter(
    (s) =>
      s.title.toLowerCase().includes(q) ||
      s.author.toLowerCase().includes(q) ||
      s.faust.includes(q) ||
      s.isbn.includes(q)
  );

  if (matches.length === 0) {
    resultsDiv.innerHTML = "<p>Ingen resultater.</p>";
    return;
  }

  matches.forEach((s) => {
    const card = document.createElement("div");
    card.className = "result-card";
    card.innerHTML = `
      <strong>${s.title}</strong> — ${s.author}<br/>
      FAUST: ${s.faust} · ISBN: ${s.isbn}<br/>
      <span class="badge ${s.available ? "green" : "red"}">
        ${s.available ? "Ledig" : "Optaget"}
      </span>
      <span class="badge blue">Region: ${s.region}</span>
    `;
    resultsDiv.appendChild(card);
  });
});

// Dummy import handler
document.getElementById("importBtn").addEventListener("click", () => {
  const fileInput = document.getElementById("fileUpload");
  const log = document.getElementById("inventory-log");
  if (!fileInput.files.length) {
    log.innerHTML = "<p style='color:red'>Vælg en fil først.</p>";
    return;
  }
  const file = fileInput.files[0];
  log.innerHTML = `<p>Importerede: <strong>${file.name}</strong> (demo – ingen backend endnu)</p>`;
});

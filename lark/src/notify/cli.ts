const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const port = process.env.NOTIFY_PORT || "4766";
const response = await fetch(`http://127.0.0.1:${port}/notify`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    title: args.get("--title"),
    status: args.get("--status") || "info",
    body: args.get("--body"),
    source: args.get("--source")
  })
});

if (!response.ok) {
  throw new Error(await response.text());
}

console.log(await response.text());

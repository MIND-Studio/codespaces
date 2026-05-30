/**
 * brand-pod-readmes — re-seed existing demo pods with the Mind "Welcome" README.
 *
 * New pods get the branded README automatically (the pod template is overridden
 * in infra/css/config.json). Pods that already existed keep their default README
 * until this runs. It renders infra/css/pod-template/base/README$.md.hbs for each
 * pod and overwrites the on-disk resource `.css-data/<pod>/README$.markdown`
 * in place (preserving the content-type-encoding filename + the sibling .acl).
 *
 * Dev-only: writes directly into the CSS file-backed store. Reversible —
 * re-running with the default CSS template would restore the old text.
 *
 * Usage:
 *   tsx scripts/brand-pod-readmes.ts              # alice mind test2
 *   tsx scripts/brand-pod-readmes.ts demo2 carla  # explicit pod list
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const templatePath = join(repoRoot, "infra/css/pod-template/base/README$.md.hbs");
const dataDir = join(repoRoot, ".css-data");

const baseUrl = (process.env.POD_BASE_URL ?? "http://localhost:3011/").replace(/\/?$/, "/");
const pods = process.argv.slice(2);
const targetPods = pods.length > 0 ? pods : ["alice", "mind", "test2"];

const template = readFileSync(templatePath, "utf8");

/** Render the Handlebars-style vars CSS passes to the pod README template. */
function render(pod: string): string {
  const podRoot = `${baseUrl}${pod}/`;
  const vars: Record<string, string> = {
    webId: `${podRoot}profile/card#me`,
    "base.path": podRoot,
    oidcIssuer: baseUrl,
  };
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, key: string) =>
    key in vars ? vars[key]! : m,
  );
}

let written = 0;
for (const pod of targetPods) {
  const target = join(dataDir, pod, "README$.markdown");
  if (!existsSync(join(dataDir, pod))) {
    console.warn(`skip ${pod}: no pod dir at .css-data/${pod}`);
    continue;
  }
  writeFileSync(target, render(pod), "utf8");
  console.log(`branded README → ${pod} (${target.replace(repoRoot + "/", "")})`);
  written++;
}
console.log(`\nDone: ${written}/${targetPods.length} pod README(s) updated.`);

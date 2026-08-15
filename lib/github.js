// GitHub as the backend: the private data repo is the source of truth,
// the Contents API is the transport, and Actions are the only way out to the internet.

const API = "https://api.github.com";
const CFG_KEY = "kitchen.github.v1";

export const paths = {
  stock: "Состояние/склад.json",
  list: "Состояние/список.json",
  rules: "Состояние/правила.json",
  history: "Состояние/расход.json",
  menu: "Состояние/меню.json",
  meals: "Состояние/трекинг.json",
  stores: "Состояние/магазины.json",
  receipt: (id) => `Чеки/${id}.json`,
  jobIn: (id) => `Задания/вход/${id}.json`,
  jobOut: (id) => `Задания/выход/${id}.json`,
};

export function config() {
  try {
    return JSON.parse(localStorage.getItem(CFG_KEY)) ?? {};
  } catch {
    return {};
  }
}

export function setConfig(next) {
  localStorage.setItem(CFG_KEY, JSON.stringify({ ...config(), ...next }));
}

export function clearConfig() {
  localStorage.removeItem(CFG_KEY);
}

export const isConfigured = () => Boolean(config().token && config().repo);

class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
  }
}

async function call(path, { method = "GET", body, token } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new GitHubError(`${res.status} ${detail.slice(0, 200)}`, res.status);
  }
  return res.status === 204 ? null : res.json();
}

/* Base64 that survives Cyrillic — btoa alone does not. */
const encode = (text) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
const decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));

/** Verify a token and repo before anything is written. */
export async function check({ token, repo }) {
  const info = await call(`/repos/${repo}`, { token });
  if (!info) throw new GitHubError("репозиторий не найден или токен не даёт к нему доступа", 404);
  if (!info.permissions?.push) throw new GitHubError("токен даёт только чтение — нужна запись", 403);
  return { name: info.full_name, private: info.private };
}

/**
 * Turn an API file record into text, refusing anything we cannot actually read.
 * The Contents API answers `encoding: "none"` above 1 MB, and these files are
 * meant to be edited by hand — so both "too big" and "someone left a comma"
 * must surface. Treating either as an empty file would overwrite the remote
 * history with whatever this browser happens to hold.
 */
export function decodeFile(file, path) {
  if (file.encoding && file.encoding !== "base64") {
    throw new GitHubError(`${path}: файл слишком велик, чтобы прочитать его через API`, 422);
  }
  return decode(String(file.content ?? "").replace(/\s/g, ""));
}

export function parseJson(text, path) {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new GitHubError(`${path}: не разбирается как JSON — ${err.message}`, 422);
  }
}

export async function readFile(path) {
  const { token, repo, branch = "main" } = config();
  const file = await call(`/repos/${repo}/contents/${encodeURI(path)}?ref=${branch}`, { token });
  if (!file) return null;
  return { sha: file.sha, text: decodeFile(file, path) };
}

export async function readJson(path, fallback = null) {
  const file = await readFile(path);
  if (!file) return { data: fallback, sha: null };
  if (!file.text.trim()) return { data: fallback, sha: file.sha };
  return { data: parseJson(file.text, path), sha: file.sha };
}

export async function writeFile(path, text, { sha, message } = {}) {
  const { token, repo, branch = "main" } = config();
  const res = await call(`/repos/${repo}/contents/${encodeURI(path)}`, {
    method: "PUT",
    token,
    body: {
      message: message ?? `kitchen: ${path}`,
      content: encode(text),
      branch,
      ...(sha ? { sha } : {}),
    },
  });
  return res?.content?.sha ?? null;
}

/**
 * Write JSON, merging against the remote if someone else got there first.
 * One user on two devices plus a second person in the store — conflicts are rare
 * but real, so a 409 re-reads and replays the merge instead of clobbering.
 */
export async function writeJson(path, build, { message, merge, attempts = 3 } = {}) {
  let remote = await readJson(path, null);

  for (let i = 0; i < attempts; i += 1) {
    const next = merge ? merge(remote.data) : build(remote.data);
    try {
      const sha = await writeFile(path, JSON.stringify(next, null, 2), { sha: remote.sha, message });
      return { data: next, sha };
    } catch (err) {
      if (err.status !== 409 && err.status !== 422) throw err;
      remote = await readJson(path, null);
    }
  }

  throw new GitHubError("не удалось записать: файл меняется быстрее, чем мы успеваем", 409);
}

/**
 * Ask the outside world for something. The browser cannot reach third-party
 * origins, so a job file goes into the repo and an Action answers it.
 */
export async function submitJob(kind, payload) {
  const id = `${Date.now()}-${kind}`;
  await writeFile(
    paths.jobIn(id),
    JSON.stringify({ id, kind, payload, at: Date.now() }, null, 2),
    { message: `kitchen: задание ${kind}` }
  );
  return id;
}

export async function pollJob(id) {
  const { data } = await readJson(paths.jobOut(id), null);
  return data;
}

/** Poll until the Action answers, with a ceiling so a broken workflow cannot hang the UI. */
export async function awaitJob(id, { timeout = 120000, every = 4000, signal } = {}) {
  const until = Date.now() + timeout;

  while (Date.now() < until) {
    if (signal?.aborted) throw new GitHubError("отменено", 0);
    const answer = await pollJob(id).catch(() => null);
    if (answer) return answer;
    await new Promise((r) => setTimeout(r, every));
  }

  throw new GitHubError("задание не ответило вовремя", 504);
}

export { GitHubError };

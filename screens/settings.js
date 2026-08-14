// Settings: the data repo, the people who share the list, and the reference tables.

import { html, raw, icon, esc, toast } from "../lib/dom.js";
import { commit, uid, touch, get, replace } from "../lib/state.js";
import { demoState, reset as resetStore, EMPTY_STATE } from "../lib/store.js";
import * as M from "../lib/model.js";
import * as gh from "../lib/github.js";
import { sync, pullReferences, pullRecipes } from "../lib/sync.js";
import { parseShelf, parseSynonyms, parseAisles, parseRecipe } from "../lib/vault.js";

let checking = false;
let checkResult = null;

export default {
  title: () => "Настройки",

  render(state) {
    const cfg = gh.config();
    const connected = gh.isConfigured();
    const others = state.people.filter((p) => !p.self);

    return html`<main class="screen">
      <header class="head"><h1>Настройки</h1></header>

      <div class="body">
        <section class="pane">
          <div class="label">Репозиторий данных</div>
          <p class="prose">Приложение хранит склад, список и справочники в твоём приватном репозитории на GitHub. Ключ доступа живёт только в этом браузере и никуда больше не уходит.</p>

          <form class="stack" data-act-submit="connect">
            <label class="fieldset">
              <span class="fieldset-label">Репозиторий</span>
              <input class="field" name="repo" value="${cfg.repo ?? ""}" placeholder="логин/kitchen-data" autocomplete="off" spellcheck="false" required>
            </label>
            <label class="fieldset">
              <span class="fieldset-label">Ключ доступа</span>
              <input class="field" name="token" type="password" value="${cfg.token ? "••••••••••••" : ""}" placeholder="github_pat_…" autocomplete="off" spellcheck="false">
            </label>
            <label class="fieldset">
              <span class="fieldset-label">Ветка</span>
              <input class="field" name="branch" value="${cfg.branch ?? "main"}" autocomplete="off" spellcheck="false">
            </label>
            <button class="btn btn--grow" type="submit" ${raw(checking ? "disabled" : "")}>${checking ? "Проверяю…" : connected ? "Проверить снова" : "Подключить"}</button>
          </form>

          ${raw(checkResult ? `<p class="prose ${checkResult.ok ? "" : "prose--alarm"}">${esc(checkResult.text)}</p>` : "")}

          <details class="note">
            <summary>Как сделать ключ</summary>
            <p class="prose">На GitHub: Settings → Developer settings → Personal access tokens → Fine-grained tokens. Доступ дать только репозиторию с данными, права — Contents: Read and write. Ключ создаёшь и вставляешь ты сам; я его не вижу и не запрашиваю.</p>
          </details>
        </section>

        <section class="pane">
          <div class="head-row">
            <div class="label">Синхронизация</div>
            <span class="head-sub num">${state.queue.length ? `${state.queue.length} правок в очереди` : "очередь пуста"}</span>
          </div>
          <p class="prose">${state.syncedAt ? `Последний обмен: ${new Date(state.syncedAt).toLocaleString("ru")}.` : "Обмена ещё не было."} Правки копятся офлайн и уходят при первой возможности; конфликты сливаются по каждой позиции отдельно.</p>
          <div class="rowbtns">
            <button class="btn btn--grow" type="button" data-act="syncNow" ${raw(connected ? "" : "disabled")}>Синхронизировать</button>
            <button class="btn btn--ghost" type="button" data-act="pullRefs" ${raw(connected ? "" : "disabled")}>Обновить справочники</button>
          </div>
        </section>

        <section class="pane">
          <div class="label">Кто ещё видит список</div>
          <p class="prose">Второй человек добавляется коллаборатором того же приватного репозитория. Он ставит приложение по той же ссылке, вводит свой ключ — и отметки в магазине сливаются у обоих.</p>

          ${raw(others.length
            ? others.map((p) => `<div class="ing" data-have="1">
                <span class="ing-name">${esc(p.name)}</span>
                <button class="chip" type="button" data-act="removePerson" data-id="${esc(p.id)}">убрать</button>
              </div>`).join("")
            : `<p class="prose prose--muted">Пока список видишь только ты.</p>`)}

          <form class="addbar" data-act-submit="addPerson">
            <input class="field" name="name" placeholder="Имя" aria-label="Имя человека" autocomplete="off" required>
            <button class="icon-btn" type="submit" aria-label="Добавить человека">${raw(icon("i-plus", { size: 22, stroke: "#1c3327" }))}</button>
          </form>
        </section>

        <section class="pane">
          <div class="label">Справочники</div>
          <p class="prose">Сроки годности, синонимы касс и порядок отделов — markdown-таблицы в волте. Правь их в Obsidian, приложение подтянет.</p>
          <div class="figures figures--tight">
            <div class="figure"><span class="figure-n num">${state.shelf.length}</span><span class="figure-t">строк в сроках</span></div>
            <div class="figure"><span class="figure-n num">${state.synonyms.length}</span><span class="figure-t">масок синонимов</span></div>
            <div class="figure"><span class="figure-n num">${Object.keys(state.rules).length}</span><span class="figure-t">правил выучено из чеков</span></div>
          </div>
        </section>

        <section class="pane pane--alarm">
          <div class="label">Опасная зона</div>
          <p class="prose prose--alarm">Сброс стирает всё, что накопилось в этом браузере. Если репозиторий подключён, данные вернутся при следующей синхронизации; если нет — исчезнут насовсем.</p>
          <div class="rowbtns">
            <button class="btn btn--ghost" type="button" data-act="loadDemo">Загрузить демо-данные</button>
            <button class="btn btn--ghost btn--danger" type="button" data-act="wipe">Стереть всё</button>
          </div>
        </section>
      </div>
    </main>`;
  },

  actions: {
    async connect(form) {
      const data = new FormData(form);
      const repo = String(data.get("repo") ?? "").trim();
      const rawToken = String(data.get("token") ?? "").trim();
      const branch = String(data.get("branch") ?? "main").trim() || "main";
      const token = rawToken.startsWith("•") ? gh.config().token : rawToken;

      if (!repo || !token) {
        checkResult = { ok: false, text: "Нужны и репозиторий, и ключ доступа." };
        return touch();
      }

      checking = true;
      checkResult = null;
      touch();

      try {
        const info = await gh.check({ token, repo });
        gh.setConfig({ token, repo, branch });
        checkResult = {
          ok: true,
          text: `Подключено: ${info.name}${info.private ? " (приватный)" : " — репозиторий публичный, личные данные лучше держать в приватном"}.`,
        };
        toast("Репозиторий подключён");
      } catch (err) {
        checkResult = { ok: false, text: `Не вышло: ${err.message}` };
      } finally {
        checking = false;
        touch();
      }
    },

    async syncNow() {
      try {
        const report = await sync();
        toast(`Синхронизировано · ${report.collections.length} разделов`);
      } catch (err) {
        toast(`Не прошло: ${err.message}`, "alarm");
      }
    },

    async pullRefs() {
      try {
        const [refs, recipeFiles] = await Promise.all([pullReferences(), pullRecipes()]);
        const parsedRecipes = recipeFiles.map((f) => parseRecipe(f.name, f.text)).filter((r) => r.ingredients.length);

        commit("refs.pull", (s) => {
          if (refs.shelf) s.shelf = parseShelf(refs.shelf);
          if (refs.synonyms) {
            const { synonyms, junk } = parseSynonyms(refs.synonyms);
            s.synonyms = synonyms;
            s.junk = junk;
          }
          if (refs.aisles) s.aisles = parseAisles(refs.aisles);
          if (parsedRecipes.length) s.recipes = parsedRecipes;
          return null;
        }, { sync: false });

        toast(`Справочники обновлены${parsedRecipes.length ? ` · ${parsedRecipes.length} рецептов` : ""}`);
      } catch (err) {
        toast(`Не удалось прочитать волт: ${err.message}`, "alarm");
      }
    },

    addPerson(form) {
      const name = String(new FormData(form).get("name") ?? "").trim();
      if (!name) return;

      commit("people.add", (s) => {
        const person = { id: uid("p"), name, self: false, at: Date.now() };
        s.people.push(person);
        return null;
      }, { sync: false });

      form.reset();
      toast(`${name} теперь видит список`);
    },

    removePerson(el) {
      commit("people.remove", (s) => {
        s.people = s.people.filter((p) => p.id !== el.dataset.id);
        return null;
      }, { sync: false });
    },

    loadDemo() {
      const s = get();
      replace({ ...demoState(M.today()), recipes: s.recipes, stores: s.stores, people: s.people }, "demo");
      toast("Демо-данные загружены");
    },

    wipe() {
      if (!confirm("Стереть весь локальный склад, список и историю?")) return;
      resetStore();
      replace(structuredClone(EMPTY_STATE), "wipe");
      toast("Стёрто");
    },
  },
};

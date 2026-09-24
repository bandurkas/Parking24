"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, RotateCcw, Save } from "lucide-react";
import { previewTemplateAction, restoreTemplateAction, saveTemplateAction } from "@/app/admin/actions/templates";
import type { TemplateView } from "@/server/services/templates";
import SaveNote, { type Note } from "./SaveNote";

export default function TemplateCard({ t, vars }: { t: TemplateView; vars: { name: string; sample: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(t.name);
  const [body, setBody] = useState(t.body);
  const [preview, setPreview] = useState<string | null>(null);
  const [note, setNote] = useState<Note>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [askRestore, setAskRestore] = useState(false);

  // После сохранения страница перечитывается: новая версия с сервера заменяет черновик (паттерн serverKey)
  const [seen, setSeen] = useState(t.version);
  if (t.version !== seen) {
    setSeen(t.version);
    setName(t.name);
    setBody(t.body);
  }

  const dirty = name !== t.name || body !== t.body;

  // Правка текста гасит устаревшее предупреждение и предпросмотр
  function change(next: { name?: string; body?: string }) {
    if (next.name !== undefined) setName(next.name);
    if (next.body !== undefined) setBody(next.body);
    setWarn(null);
    setPreview(null);
  }

  function doPreview() {
    setNote(null);
    start(async () => {
      const res = await previewTemplateAction(body);
      if (res.ok) setPreview(res.text);
      else setNote({ ok: false, text: res.error });
    });
  }

  function save(force = false) {
    setNote(null);
    start(async () => {
      const res = await saveTemplateAction(t.code, name, body, t.version, force);
      if (res.ok) {
        setWarn(null);
        setNote({ ok: true, text: "Сохранено" });
        router.refresh();
      } else if (res.confirm) {
        setWarn(res.error);
      } else {
        setWarn(null);
        setNote({ ok: false, text: res.error });
      }
    });
  }

  function restore() {
    setNote(null);
    start(async () => {
      const res = await restoreTemplateAction(t.code, t.version);
      setAskRestore(false);
      setNote(res.ok ? { ok: true, text: "Возвращён текст по умолчанию" } : { ok: false, text: res.error });
      if (res.ok) {
        setPreview(null);
        router.refresh();
      }
    });
  }

  return (
    <section className="adm-card p-4 sm:p-5" data-template={t.code} aria-label={`Шаблон ${t.name}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="min-w-0 sm:flex-1">
          <input value={name} onChange={(e) => change({ name: e.target.value })} aria-label="Название шаблона" className="adm-input h-10 font-semibold" />
          <div className="mt-0.5 font-mono text-[11px] text-ink-muted">{t.code}</div>
        </div>
        <div className="flex flex-wrap gap-2 sm:max-w-[45%] sm:justify-end">
          {t.edited ? (
            <span data-testid="edited-badge" className="rounded-md bg-warning/15 px-2 py-1 text-xs font-semibold text-[#8a5a00]">
              Правлено{t.edited.by ? `: ${t.edited.by}` : ""}, {t.edited.at}
            </span>
          ) : (
            <span data-testid="default-badge" className="rounded-md bg-surface px-2 py-1 text-xs font-semibold text-ink-muted">Текст по умолчанию</span>
          )}
          {!t.isActive && <span className="rounded-md bg-danger/8 px-2 py-1 text-xs font-semibold text-danger">Шаблон выключен — правила с ним не отправляют</span>}
        </div>
      </div>

      <textarea
        value={body}
        onChange={(e) => change({ body: e.target.value })}
        aria-label="Текст шаблона"
        rows={Math.min(22, Math.max(6, body.split("\n").length + 1))}
        className="adm-input mt-3 h-auto py-2 leading-relaxed"
      />

      {warn && (
        <div className="mt-2 rounded-lg bg-warning/15 px-3 py-2 text-sm text-[#8a5a00]" role="alert">
          <div>{warn}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => save(true)} disabled={pending} className="adm-btn-primary h-9 px-3 text-sm">Сохранить всё равно</button>
            <button type="button" onClick={() => setWarn(null)} className="adm-btn h-9 px-3 text-sm">Исправить</button>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={doPreview} disabled={pending} className="adm-btn h-10 px-3 text-sm">
          <Eye size={15} /> Предпросмотр
        </button>
        <button type="button" onClick={() => save()} disabled={pending || !dirty} className="adm-btn-primary h-10 px-4 text-sm">
          <Save size={15} /> {pending ? "…" : "Сохранить"}
        </button>
        {dirty && (
          <button type="button" onClick={() => change({ name: t.name, body: t.body })} className="adm-btn-ghost h-10 px-3 text-sm">
            Отменить правку
          </button>
        )}
        <SaveNote note={note} className="ml-auto" />
      </div>

      {preview !== null && (
        <div className="mt-3 rounded-lg bg-surface-soft p-3" aria-label="Предпросмотр">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-steel">Так увидит клиент · демонстрационная бронь</div>
          <div data-testid="preview" className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{preview}</div>
        </div>
      )}

      {t.edited && (
        t.defaultBody !== null ? (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-ink-muted">Текст по умолчанию</summary>
            <div className="mt-2 whitespace-pre-wrap rounded-lg bg-surface-soft p-3 text-ink-muted [overflow-wrap:anywhere]">{t.defaultBody}</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {askRestore ? (
                <>
                  <span className="text-ink-muted">Ваш текст заменится текстом по умолчанию.</span>
                  <button type="button" onClick={restore} disabled={pending} className="adm-btn-danger h-9 px-3 text-sm">Да, вернуть</button>
                  <button type="button" onClick={() => setAskRestore(false)} className="adm-btn h-9 px-3 text-sm">Отмена</button>
                </>
              ) : (
                <button type="button" onClick={() => setAskRestore(true)} className="adm-btn h-9 px-3 text-sm">
                  <RotateCcw size={14} /> Вернуть текст по умолчанию
                </button>
              )}
            </div>
          </details>
        ) : (
          <div className="mt-3 text-xs text-ink-muted">Текст по умолчанию не записан</div>
        )
      )}

      <div className="mt-3 border-t border-line pt-3 text-sm">
        <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Когда срабатывает</div>
        {t.rules.length === 0 ? (
          <div className="mt-1 text-ink-muted">Ни одно правило этот шаблон не отправляет</div>
        ) : (
          <ul className="mt-1 space-y-0.5">
            {t.rules.map((r) => (
              <li key={r.code} className={r.isActive ? "" : "text-ink-muted"}>
                {r.when}
                {!r.isActive && <span className="ml-1 text-xs">· правило выключено</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-ink-muted">Переменные</summary>
        <div className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
          {vars.map((v) => (
            <div key={v.name} className="min-w-0 [overflow-wrap:anywhere]">
              <span className="font-mono text-xs text-primary-deep">{`{{${v.name}}}`}</span>
              <span className="text-ink-muted"> — {v.sample || "пусто"}</span>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}

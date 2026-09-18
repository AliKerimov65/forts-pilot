// Шаг 1 онбординга — ввод API-токена (connection.md)
// Маскирование (password + глаз), вставка из буфера, живая валидация формата `t.`,
// accordion-инструкция «Как получить токен», кнопка «Проверить токен» со спиннером,
// ошибки: красная рамка + shake + понятная подпись.
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, ClipboardPaste, ExternalLink, Eye, EyeOff, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { toast } from '@/components/connect/toast';

const TOKEN_RE = /^t\.[A-Za-z0-9_-]{10,}$/;

const HELP_STEPS = [
  'Откройте tinkoff.ru/invest и войдите в свой профиль.',
  'Перейдите в ⚙ «Настройки профиля» (шестерёнка в правом верхнем углу).',
  'Найдите раздел «Токены T-Invest API» и нажмите «Создать токен».',
  'Выберите права «Чтение» и «Торговля», затем скопируйте токен — он начинается с «t.».',
];

export interface TokenStepProps {
  /** Проверка токена (реальный GetAccounts). Вернуть null при успехе, иначе текст ошибки. */
  verify: (token: string) => Promise<string | null>;
}

export default function TokenStep({ verify }: TokenStepProps) {
  const [token, setToken] = useState('');
  const [visible, setVisible] = useState(false);
  const [checking, setChecking] = useState(false);
  const [formatOk, setFormatOk] = useState<boolean | null>(null); // null — поле пустое
  const [error, setError] = useState('');
  const [shakeNonce, setShakeNonce] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Живая валидация формата с debounce 300ms (в обработчике ввода)
  const handleChange = (v: string) => {
    setToken(v);
    setError('');
    clearTimeout(debounceRef.current);
    if (!v) {
      setFormatOk(null);
      return;
    }
    debounceRef.current = setTimeout(() => setFormatOk(TOKEN_RE.test(v.trim())), 300);
  };

  // Очистка таймера при размонтировании
  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        toast('Буфер обмена пуст', { variant: 'warn' });
        return;
      }
      handleChange(text.trim());
    } catch {
      toast('Нет доступа к буферу обмена', {
        details: 'Разрешите доступ или вставьте токен вручную',
        variant: 'warn',
      });
    }
  };

  const submit = async () => {
    const t = token.trim();
    if (!TOKEN_RE.test(t)) {
      setFormatOk(false);
      setError('Формат токена неверный: токен начинается с «t.»');
      setShakeNonce((n) => n + 1);
      return;
    }
    setChecking(true);
    setError('');
    const err = await verify(t);
    setChecking(false);
    if (err) {
      setError(err);
      setShakeNonce((n) => n + 1);
    }
  };

  const borderClass = error
    ? 'border-short'
    : formatOk === true
      ? 'border-long'
      : formatOk === false
        ? 'border-warn'
        : 'border-subtle focus-within:border-strong';

  return (
    <div className="space-y-3">
      <motion.div
        key={shakeNonce}
        animate={shakeNonce ? { x: [0, -8, 8, -6, 6, 0] } : undefined}
        transition={{ duration: 0.3 }}
        className={cn('flex items-center gap-2 rounded-[10px] border bg-inset px-3 transition-colors', borderClass, checking && 'animate-pulse')}
      >
        <input
          type={visible ? 'text' : 'password'}
          value={token}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !checking && submit()}
          placeholder="t.…"
          autoComplete="off"
          spellCheck={false}
          className="mono h-12 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-muted"
          aria-label="API-токен Т-Инвестиций"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-panel-raised hover:text-fg"
          aria-label={visible ? 'Скрыть токен' : 'Показать токен'}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={pasteFromClipboard}
          className="flex h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-fg-secondary transition-colors hover:bg-panel-raised hover:text-fg"
        >
          <ClipboardPaste className="h-4 w-4" />
          <span className="hidden sm:inline">Вставить</span>
        </button>
      </motion.div>

      {/* Состояние поля: ошибка / успех / подсказка формата */}
      <AnimatePresence mode="wait">
        {error ? (
          <motion.p key="err" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-xs font-medium text-short">
            {error}
          </motion.p>
        ) : formatOk === true ? (
          <motion.p
            key="ok"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-1.5 text-xs font-medium text-long"
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> Формат токена корректный
          </motion.p>
        ) : formatOk === false ? (
          <motion.p key="bad" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-xs font-medium text-warn">
            Токен должен начинаться с «t.» и содержать ключ доступа
          </motion.p>
        ) : null}
      </AnimatePresence>

      {/* Инструкция */}
      <Accordion type="single" collapsible>
        <AccordionItem value="help" className="border-none">
          <AccordionTrigger className="h-9 px-0 text-xs font-semibold text-yellow hover:no-underline">
            Как получить токен →
          </AccordionTrigger>
          <AccordionContent>
            <ol className="space-y-2 rounded-[10px] border border-subtle bg-inset p-3">
              {HELP_STEPS.map((s, i) => (
                <li key={i} className="flex gap-2.5 text-xs leading-relaxed text-fg-secondary">
                  <span className="mono flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-panel-raised text-[10px] font-bold text-yellow">
                    {i + 1}
                  </span>
                  {s}
                </li>
              ))}
              <li className="pt-1">
                <a
                  href="https://developer.tbank.ru/invest"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-info hover:underline"
                >
                  Документация T-Invest API <ExternalLink className="h-3 w-3" />
                </a>
              </li>
            </ol>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <button
        type="button"
        onClick={submit}
        disabled={checking || !token.trim()}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-yellow text-sm font-bold text-app transition-shadow hover:glow-accent disabled:opacity-50"
      >
        {checking && <Loader2 className="h-4 w-4 animate-spin" />}
        {checking ? 'Проверяем токен…' : 'Проверить токен'}
      </button>
    </div>
  );
}

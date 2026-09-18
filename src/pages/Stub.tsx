// Заглушка страницы «Скоро» — page-агенты заменят на полную реализацию.
import { motion } from 'framer-motion';
import { Hammer } from 'lucide-react';

export default function Stub({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className="flex min-h-[50dvh] flex-col items-center justify-center gap-4 rounded-xl border border-subtle bg-panel p-8 text-center"
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-panel-raised">
        <Hammer className="h-7 w-7 text-yellow" />
      </div>
      <div>
        <h1 className="text-xl font-bold text-fg">{title}</h1>
        <p className="mt-1 text-sm text-fg-secondary">{subtitle ?? 'Скоро — раздел в разработке'}</p>
      </div>
    </motion.div>
  );
}

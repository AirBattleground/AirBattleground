import type { ReactNode } from "react";
import { motion, type Variants } from "framer-motion";

const list: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
const item: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] } },
};

/** Container whose StaggerItem children rise in one after another. */
export function StaggerList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div variants={list} initial="hidden" animate="show" className={className}>
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div variants={item} layout="position" className={className}>
      {children}
    </motion.div>
  );
}

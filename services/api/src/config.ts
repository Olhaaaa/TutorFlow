/** Читання й перевірка оточення. Падати на старті краще, ніж на першому запросі. */
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`не задано змінну оточення ${name} — див. .env.example`);
  return v;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  port: Number(process.env.PORT ?? 8080),
  jwtSecret: required('JWT_SECRET'),
  /** Зона викладача. Використовується при генерації слотів із настінного часу. */
  teacherTimezone: process.env.TEACHER_TIMEZONE ?? 'Europe/Kyiv',
};

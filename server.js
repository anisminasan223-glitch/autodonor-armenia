import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const uploadDir = path.join(os.tmpdir(), 'autodonor-uploads');
await fs.promises.mkdir(uploadDir, { recursive: true });

const MAX_FILES = 10;
const MAX_FILE_SIZE = 16 * 1024 * 1024;
const upload = multer({
  dest: uploadDir,
  limits: { files: MAX_FILES, fileSize: MAX_FILE_SIZE }
});

const PORT = Number(process.env.PORT || 3000);
const MAIL_HOST = (process.env.MAIL_HOST || 'smtp.mail.ru').trim();
const MAIL_PORT = Number(process.env.MAIL_PORT || 465);
const MAIL_USER = process.env.MAIL_USER?.trim();
const MAIL_PASS = process.env.MAIL_PASS?.trim();
const MAIL_TO = (process.env.MAIL_TO || 'autodonorarmenia@mail.ru').trim();

const mailer = MAIL_USER && MAIL_PASS ? nodemailer.createTransport({
  host: MAIL_HOST,
  port: MAIL_PORT,
  secure: MAIL_PORT === 465,
  auth: { user: MAIL_USER, pass: MAIL_PASS },
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 30000
}) : null;

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.post('/api/lead', upload.array('media', MAX_FILES), async (req, res) => {
  const files = req.files || [];
  try {
    if (!mailer) {
      throw new Error('Почта не настроена. Заполните MAIL_USER и MAIL_PASS в .env.');
    }

    const { name = '', phone = '', brand = '', model = '', details = '' } = req.body;
    const safeBrand = String(brand).slice(0, 100);
    const safeModel = String(model).slice(0, 100);
    const subject = `Новая оценка автомобиля — ${safeBrand || 'автомобиль'} ${safeModel}`.trim();
    const text = [
      'НОВАЯ ЗАЯВКА — AutoDonor Armenia',
      '',
      `Имя: ${String(name).slice(0, 200)}`,
      `Телефон: ${String(phone).slice(0, 100)}`,
      `Марка: ${safeBrand}`,
      `Модель / год: ${safeModel}`,
      `Состояние: ${String(details).slice(0, 3000)}`,
      '',
      `Файлов во вложении: ${files.length}`
    ].join('\n');

    await mailer.sendMail({
      from: MAIL_USER,
      to: MAIL_TO,
      subject,
      text,
      attachments: files.map(file => ({
        filename: file.originalname,
        path: file.path,
        contentType: file.mimetype
      }))
    });

    res.json({
      ok: true,
      emailSent: true,
      email: MAIL_TO,
      filesAttached: files.length
    });
  } catch (err) {
    console.error('[lead]', err);
    res.status(502).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Ошибка отправки заявки.'
    });
  } finally {
    await Promise.all(files.map(file => fs.promises.unlink(file.path).catch(() => {})));
  }
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'Один из файлов больше 16 МБ.'
      : err.code === 'LIMIT_FILE_COUNT'
        ? 'Можно прикрепить не более 10 файлов.'
        : 'Ошибка загрузки файлов.';
    return res.status(400).json({ ok: false, error: message });
  }
  console.error('[server]', err);
  return res.status(500).json({ ok: false, error: 'Ошибка сервера.' });
});

app.get('/health', (_req, res) => res.json({
  ok: true,
  mailConfigured: Boolean(mailer),
  mailTo: MAIL_TO
}));

app.listen(PORT, () => console.log(`AutoDonor Armenia listening on port ${PORT}`));

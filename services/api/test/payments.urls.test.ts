/**
 * Правило адрес платежу. Бази не потребує — це чиста функція, але живе вона в
 * сервісі, а не в ядрі: знання про те, що провайдер приходить із зовнішнього
 * інтернету, належить межі з провайдером, а не домену розкладу й грошей.
 */
import { describe, expect, it } from 'vitest';
import { returnUrl, webhookUrl } from '../src/payments/urls.js';

describe('адреса вебхука', () => {
  it('публічний https — повна адреса колбека', () => {
    expect(webhookUrl('https://tutorflow.example.com')).toBe(
      'https://tutorflow.example.com/api/payments/monobank/callback',
    );
  });

  it('адреса з хвостом не ламає шлях колбека', () => {
    expect(webhookUrl('https://abc-123.trycloudflare.com/')).toBe(
      'https://abc-123.trycloudflare.com/api/payments/monobank/callback',
    );
  });

  it('локальні адреси не віддаються: провайдер туди не дійде', () => {
    expect(webhookUrl('http://localhost:5173')).toBeNull();
    expect(webhookUrl('https://localhost:8080')).toBeNull();
    expect(webhookUrl('http://127.0.0.1:8080')).toBeNull();
    expect(webhookUrl('https://192.168.1.10')).toBeNull();
    expect(webhookUrl('https://10.0.0.5')).toBeNull();
    expect(webhookUrl('https://172.20.0.3')).toBeNull();
    expect(webhookUrl('https://macbook.local')).toBeNull();
  });

  it('172.x поза приватним діапазоном — публічна адреса', () => {
    expect(webhookUrl('https://172.15.0.3')).not.toBeNull();
    expect(webhookUrl('https://172.32.0.3')).not.toBeNull();
  });

  it('http не годиться навіть на публічному хості', () => {
    expect(webhookUrl('http://tutorflow.example.com')).toBeNull();
  });

  it('порожнє й сміття дають null, а не виняток', () => {
    expect(webhookUrl(null)).toBeNull();
    expect(webhookUrl('')).toBeNull();
    expect(webhookUrl('не адреса')).toBeNull();
  });
});

describe('адреса повернення', () => {
  it('localhost годиться: її відкриває браузер студента', () => {
    expect(returnUrl('http://localhost:5173', 42)).toBe('http://localhost:5173/#payment-42');
  });

  it('публічна адреса так само', () => {
    expect(returnUrl('https://tutorflow.example.com', 7)).toBe(
      'https://tutorflow.example.com/#payment-7',
    );
  });

  it('без заданої адреси повернення немає', () => {
    expect(returnUrl(null, 1)).toBeNull();
  });
});

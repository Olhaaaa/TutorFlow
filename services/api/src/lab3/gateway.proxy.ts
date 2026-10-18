import { All, Controller, Get, Logger, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { INTERNAL_TOKEN_HEADER } from '@tutorflow/contracts';
import { lab3, peerUrl } from './config.js';
import { routeFor, routingTable } from './gateway.routes.js';

/**
 * Єдиний вхід у систему.
 *
 * Для клієнта нічого не змінилось: той самий `/api`, той самий токен у
 * заголовку, та сама збірка SPA з того самого походження. Саме через це
 * фронтенд лабораторної 3 не відрізняється від фронтенду лабораторної 1 ні
 * рядком — і порівнювати архітектури можна, не переписуючи клієнта.
 *
 * Три подробиці, які тут важливі.
 *
 * **Тіло передається БАЙТАМИ, а не розібраним JSON.** Вебхук платежів
 * підписаний провайдером по байтах тіла, і повторна серіалізація зламала б
 * підпис: `{"a":1}` і `{ "a": 1 }` — однаковий JSON і різні байти.
 *
 * **Заголовок авторизації передається як є.** Gateway не перевіряє токен і не
 * розбирає його: сервіс, який відповідає, зробить це сам. Так жоден запрос не
 * залежить від доступності сервіса входу.
 *
 * **Службовий заголовок додається тут.** Назовні його немає — клієнт його не
 * надсилає й не знає, — а внутрішні маршрути за ним відрізняють сусіда від
 * світу.
 */
@ApiExcludeController()
@Controller()
export class GatewayController {
  private readonly log = new Logger('Gateway');

  /**
   * Живість gateway. Бази в нього немає, тому відповідь не про дані, а про
   * те, куди він вміє ходити: таблиця маршрутів у відповіді робить помилку
   * конфігурації видною одним curl-ом.
   */
  @Get('healthz')
  health(): { status: string; service: string; routes: { prefix: string; service: string }[] } {
    return { status: 'ok', service: 'gateway', routes: routingTable() };
  }

  @All('api/*')
  async proxy(@Req() req: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    const url = new URL(req.url, 'http://gateway.local');
    const service = routeFor(url.pathname);
    const target = `${peerUrl(service)}${url.pathname}${url.search}`;

    // Тіло беремо сирим. rawBody дає Fastify у вигляді Buffer; для GET і
    // DELETE його немає взагалі.
    const body = (req as FastifyRequest & { rawBody?: Buffer }).rawBody;

    let upstream: Response;
    try {
      upstream = await fetch(target, {
        method: req.method,
        headers: forwardedHeaders(req.headers),
        ...(body && body.length > 0 ? { body } : {}),
        signal: AbortSignal.timeout(lab3.internalTimeoutMs * 3),
      });
    } catch (e) {
      // Сервіс не відповів. 502 — чесніше за 500: справа не в запросі, а в
      // тому, що за gateway зараз нікого немає.
      this.log.warn(`${service} не відповів на ${req.method} ${url.pathname}: ${msg(e)}`);
      await reply.status(502).send({
        statusCode: 502,
        message: `сервіс ${service} недоступний`,
      });
      return;
    }

    const payload = Buffer.from(await upstream.arrayBuffer());
    const type = upstream.headers.get('content-type');

    await reply
      .status(upstream.status)
      .headers({
        ...(type ? { 'content-type': type } : {}),
        // Стрічку .ics кешують проміжні кеші — заголовок сервіса мусить дійти
        // до клієнта, інакше календар перечитував би її щоразу.
        ...(upstream.headers.get('cache-control')
          ? { 'cache-control': upstream.headers.get('cache-control')! }
          : {}),
      })
      .send(payload);
  }
}

/**
 * Які заголовки їдуть далі.
 *
 * Перелік білий, а не чорний: хост, довжина й кодування стосуються ЦЬОГО
 * з'єднання, і передавати їх означало б описувати сусідові не той запрос,
 * який до нього приходить.
 */
function forwardedHeaders(incoming: FastifyRequest['headers']): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of ['authorization', 'content-type', 'accept', 'x-student-id', 'x-teacher-id']) {
    const value = incoming[name];
    if (typeof value === 'string') headers[name] = value;
  }
  if (lab3.internalToken) headers[INTERNAL_TOKEN_HEADER] = lab3.internalToken;
  return headers;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

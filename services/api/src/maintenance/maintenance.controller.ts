import { Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTeacher } from '../auth/current-user.decorator.js';
import { MaintenanceService } from './maintenance.service.js';

@ApiTags('Службове')
@Controller()
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  /**
   * Ручний запуск переходів, які робить час.
   *
   * Потрібен для демонстрації: чекати таймера, щоб показати, як звільняється
   * неоплачене закріплення, незручно. Нічого «зайвого» викладач цим не
   * зробить — застосовуються лише переходи, час яких уже настав за годинником.
   */
  @Post('teacher/maintenance')
  @HttpCode(200)
  @ApiOperation({ summary: 'Застосувати переходи станів, час яких настав' })
  run(@CurrentTeacher() _teacher: { id: number }) {
    return this.maintenance.runOnce();
  }
}

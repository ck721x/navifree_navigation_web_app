import { ArgumentsHost, BadRequestException, Body, Catch, Controller, ExceptionFilter, Get, HttpException, Inject, Module, Post, Query } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { adviceRequestSchema, getLocalAdvice, routeRequestSchema } from '@navifree/core';
import type { Response } from 'express';
import { z } from 'zod';
import { ProviderService } from './provider.service';

@Catch()
class SafeErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const parserType = typeof error === 'object' && error !== null && 'type' in error ? error.type : null;
    const status = error instanceof HttpException ? error.getStatus() : parserType === 'entity.too.large' ? 413 : parserType === 'entity.parse.failed' ? 400 : 500;
    const message = error instanceof HttpException ? error.message : status === 413 ? 'The request is too large.' : status === 400 ? 'Invalid JSON request.' : 'The service could not complete this request.';
    response.status(status).json({ message, statusCode: status });
  }
}

@Controller()
class AppController {
  constructor(@Inject(ProviderService) private readonly providers: ProviderService) {}

  @Get('health') health() { return { status: 'ok' }; }
  @Get('v1/capabilities') capabilities() { return this.providers.capabilities(); }

  @Get('v1/places/search') search(@Query('q') value: unknown) {
    const query = z.string().trim().min(3).max(150).safeParse(value);
    if (!query.success) throw new BadRequestException('Enter a search between 3 and 150 characters.');
    return this.providers.search(query.data);
  }

  @Post('v1/routes') route(@Body() body: unknown) {
    const request = routeRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException('Enter valid latitude and longitude coordinates and a supported provider.');
    if (request.data.avoidTolls && request.data.provider === 'demo') throw new BadRequestException('Demo mode does not support toll avoidance.');
    return this.providers.route(request.data);
  }

  @Post('v1/recommendations') advice(@Body() body: unknown) {
    const request = adviceRequestSchema.safeParse(body);
    if (!request.success) throw new BadRequestException('Enter a question of 1–500 characters and a valid route.');
    return { answer: getLocalAdvice(request.data.question, request.data.route), source: 'local-rules' };
  }
}

@Module({ controllers: [AppController], providers: [ProviderService, { provide: APP_FILTER, useClass: SafeErrorFilter }] })
export class AppModule {}

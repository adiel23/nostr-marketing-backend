import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WsAdapter } from '@nestjs/platform-ws';
import {ValidationPipe} from "@nestjs/common";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
    credentials: true,
  });
  app.useWebSocketAdapter(new WsAdapter(app));
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true, // Elimina propiedades no definidas en el DTO
    forbidNonWhitelisted: true, // Lanza un error si hay propiedades no definidas en el DTO
    transform: true, // Transforma los payloads a instancias de clases
  }));
  if (process.env.NODE_ENV === 'production') {
    app.use('/queues', (_request, response) => {
      response.status(404).send();
    });
  }
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap();

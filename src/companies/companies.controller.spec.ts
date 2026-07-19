import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';

describe('CompaniesController', () => {
  let controller: CompaniesController;
  const companiesService = {
    create: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };
  const request = { user: { id: 'company-id', email: 'company@example.test' } };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CompaniesController],
      providers: [
        {
          provide: CompaniesService,
          useValue: companiesService,
        },
      ],
    }).compile();

    controller = module.get<CompaniesController>(CompaniesController);
  });

  function guardsFor(methodName: string): unknown {
    const descriptor = Object.getOwnPropertyDescriptor(
      CompaniesController.prototype,
      methodName,
    );
    if (!descriptor || typeof descriptor.value !== 'function') {
      throw new Error(`No se encontró el método ${methodName}.`);
    }

    return Reflect.getMetadata(
      GUARDS_METADATA,
      descriptor.value as object,
    ) as unknown;
  }

  it('keeps registration public', () => {
    expect(guardsFor('create')).toBeUndefined();
  });

  it.each(['findOne', 'update', 'remove'] as const)(
    'protects %s with JWT authentication',
    (methodName) => {
      expect(guardsFor(methodName)).toContain(JwtAuthGuard);
    },
  );

  it('passes the authenticated company id to protected operations', () => {
    void controller.findOne('company-id', request);
    void controller.update('company-id', { name: 'Nuevo nombre' }, request);
    void controller.remove('company-id', request);

    expect(companiesService.findOne).toHaveBeenCalledWith(
      'company-id',
      'company-id',
    );
    expect(companiesService.update).toHaveBeenCalledWith(
      'company-id',
      'company-id',
      { name: 'Nuevo nombre' },
    );
    expect(companiesService.remove).toHaveBeenCalledWith(
      'company-id',
      'company-id',
    );
  });
});

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Test, TestingModule } from '@nestjs/testing';
import { CompaniesService } from './companies.service';
import { Company } from './entities/company.entity';

describe('CompaniesService', () => {
  let service: CompaniesService;
  const companiesRepository = {
    create: jest.fn<Company, [Partial<Company>]>(),
    save: jest.fn<Promise<Company>, [Company]>(),
    findOne: jest.fn<Promise<Company | null>, [{ where: Partial<Company> }]>(),
    remove: jest.fn<Promise<Company>, [Company]>(),
  };
  const company = {
    id: 'company-id',
    name: 'Empresa',
    email: 'empresa@example.com',
    passwordHash: bcrypt.hashSync('password-original', 10),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  } as Company;
  let createdCompany: Company | undefined;

  beforeEach(async () => {
    jest.clearAllMocks();
    createdCompany = undefined;
    companiesRepository.create.mockImplementation((input) => {
      createdCompany = {
        ...input,
        id: company.id,
        createdAt: company.createdAt,
      } as Company;
      return createdCompany;
    });
    companiesRepository.save.mockImplementation((input) =>
      Promise.resolve(input),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompaniesService,
        {
          provide: getRepositoryToken(Company),
          useValue: companiesRepository,
        },
      ],
    }).compile();

    service = module.get<CompaniesService>(CompaniesService);
  });

  it('creates a company without returning its password hash', async () => {
    const result = await service.create({
      name: 'Empresa',
      email: 'empresa@example.com',
      password: 'password-seguro',
    });

    expect(createdCompany).toBeDefined();
    if (!createdCompany) {
      throw new Error('La empresa no fue creada.');
    }
    await expect(
      bcrypt.compare('password-seguro', createdCompany.passwordHash),
    ).resolves.toBe(true);
    expect(result).toEqual({
      id: company.id,
      name: 'Empresa',
      email: 'empresa@example.com',
      createdAt: company.createdAt,
    });
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('returns only the owner company data', async () => {
    companiesRepository.findOne.mockResolvedValue(company);

    await expect(service.findOne('company-id', 'company-id')).resolves.toEqual({
      id: company.id,
      name: company.name,
      email: company.email,
      createdAt: company.createdAt,
    });
  });

  it('does not allow looking up a different company', async () => {
    await expect(
      service.findOne('other-company', 'company-id'),
    ).rejects.toThrow(NotFoundException);
    expect(companiesRepository.findOne).not.toHaveBeenCalled();
  });

  it('hashes a new password before saving the owner company', async () => {
    const storedCompany = { ...company };
    companiesRepository.findOne.mockResolvedValue(storedCompany);

    const result = await service.update('company-id', 'company-id', {
      password: 'password-nueva',
    });

    await expect(
      bcrypt.compare('password-nueva', storedCompany.passwordHash),
    ).resolves.toBe(true);
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('rejects an empty company update', async () => {
    companiesRepository.findOne.mockResolvedValue(company);

    await expect(
      service.update('company-id', 'company-id', {}),
    ).rejects.toThrow(BadRequestException);
  });

  it('translates duplicate emails to a conflict response', async () => {
    companiesRepository.save.mockRejectedValue({ code: '23505' });

    await expect(
      service.create({
        name: 'Empresa',
        email: 'empresa@example.com',
        password: 'password-seguro',
      }),
    ).rejects.toThrow(ConflictException);
  });
});

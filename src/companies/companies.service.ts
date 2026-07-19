import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { CreateCompanyDto } from './dto/create-company.dto';
import { CompanyResponseDto } from './dto/company-response.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { Company } from './entities/company.entity';

@Injectable()
export class CompaniesService {
  constructor(
    @InjectRepository(Company)
    private readonly companiesRepository: Repository<Company>,
  ) {}

  async create(
    createCompanyDto: CreateCompanyDto,
  ): Promise<CompanyResponseDto> {
    const { name, email, password } = createCompanyDto;
    const passwordHash = await bcrypt.hash(password, 10);
    const company = this.companiesRepository.create({
      name,
      email,
      passwordHash,
    });

    try {
      return this.toResponse(await this.companiesRepository.save(company));
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('Ya existe una empresa con ese email.');
      }
      throw error;
    }
  }

  async validateCompany(
    email: string,
    password: string,
  ): Promise<Company | null> {
    const company = await this.companiesRepository.findOne({
      where: { email },
    });

    if (!company) {
      return null;
    }

    const isPasswordValid = await bcrypt.compare(
      password,
      company.passwordHash,
    );
    return isPasswordValid ? company : null;
  }

  async findOne(id: string, ownerId: string): Promise<CompanyResponseDto> {
    return this.toResponse(await this.findOwnedCompany(id, ownerId));
  }

  async update(
    id: string,
    ownerId: string,
    updateCompanyDto: UpdateCompanyDto,
  ): Promise<CompanyResponseDto> {
    const company = await this.findOwnedCompany(id, ownerId);
    const { name, email, password } = updateCompanyDto;

    if (name === undefined && email === undefined && password === undefined) {
      throw new BadRequestException(
        'No se proporcionaron campos actualizables para la empresa.',
      );
    }

    if (name !== undefined) company.name = name;
    if (email !== undefined) company.email = email;
    if (password !== undefined)
      company.passwordHash = await bcrypt.hash(password, 10);

    try {
      return this.toResponse(await this.companiesRepository.save(company));
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('Ya existe una empresa con ese email.');
      }
      throw error;
    }
  }

  async remove(id: string, ownerId: string): Promise<void> {
    const company = await this.findOwnedCompany(id, ownerId);
    await this.companiesRepository.remove(company);
  }

  private async findOwnedCompany(
    id: string,
    ownerId: string,
  ): Promise<Company> {
    if (id !== ownerId) {
      throw new NotFoundException('Empresa no encontrada.');
    }

    const company = await this.companiesRepository.findOne({
      where: { id: ownerId },
    });
    if (!company) {
      throw new NotFoundException('Empresa no encontrada.');
    }

    return company;
  }

  private toResponse(company: Company): CompanyResponseDto {
    return {
      id: company.id,
      name: company.name,
      email: company.email,
      createdAt: company.createdAt,
    };
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === '23505'
    );
  }
}

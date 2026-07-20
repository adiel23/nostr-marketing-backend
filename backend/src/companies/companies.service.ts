import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Company } from './entities/company.entity';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class CompaniesService {
  constructor(
    @InjectRepository(Company)
    private companiesRepository: Repository<Company>, // Inyección del repositorio
  ) {}

  async create(createCompanyDto: CreateCompanyDto) {
    // 1. Extraemos los datos que vienen del cliente
    const { name, email, password } = createCompanyDto;

    // 2. Encriptamos la contraseña de forma segura
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // 3. Creamos la entidad mapeando el password al campo password_hash
    const company = this.companiesRepository.create({
      name,
      email,
      passwordHash,
    });

    // 4. Guardamos en la base de datos y retornamos la entidad creada
    return this.companiesRepository.save(company);
  }

  async validateCompany(email: string, password: string) {
    const company = await this.companiesRepository.findOne({ where: { email } });

    if (!company) {
      return null; // No se encontró la empresa
    }

    const isPasswordValid = await bcrypt.compare(password, company.passwordHash);
    if (!isPasswordValid) {
      return null; // Contraseña incorrecta
    }

    return company; // Empresa validada correctamente
  }

  findAll() {
    return this.companiesRepository.find(); // Devuelve todas las entidades
  }

  findOne(id: string) {
    return this.companiesRepository.findOne({ where: { id } }); // Devuelve una entidad por ID
  }

  update(id: string, updateCompanyDto: UpdateCompanyDto) {
    return this.companiesRepository.update(id, updateCompanyDto); // Actualiza una entidad por ID
  }

  remove(id: string) {
    return this.companiesRepository.delete(id); // Elimina una entidad por ID
  }
}

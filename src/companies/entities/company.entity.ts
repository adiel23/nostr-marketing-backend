import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn 
} from 'typeorm';

@Entity({ name: 'companies' }) // Puedes cambiar 'users' por el nombre real de tu tabla si es diferente
export class Company {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', nullable: false })
  name!: string;

  @Column({ type: 'varchar', unique: true, nullable: false })
  email!: string;

  @Column({ name: 'password_hash', type: 'varchar', nullable: false })
  passwordHash!: string;

  @CreateDateColumn({ 
    name: 'created_at', 
    type: 'timestamp', 
    default: () => 'CURRENT_TIMESTAMP' 
  })
  createdAt!: Date;
}
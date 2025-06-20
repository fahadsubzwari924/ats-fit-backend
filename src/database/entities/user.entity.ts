import { Column, Entity, PrimaryGeneratedColumn, OneToMany } from 'typeorm';
import { Resume } from './resume.entity';

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  full_name: string;

  @Column({ unique: true })
  email: string;

  @Column()
  password: string;

  @OneToMany(() => Resume, (resume) => resume.user)
  resumes: Resume[];
}

import { Column, Entity, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';
import { User } from './user.entity';
import { ResumeTemplate } from './resume-templates.entity';

@Entity({ name: 'resumes' })
export class Resume {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  file_path: string;

  @Column('text')
  original_content: string;

  @Column('text')
  tailored_content: string;

  @Column()
  created_at: Date;

  @ManyToOne(() => User, (user) => user.resumes)
  user: User;

  @ManyToOne(() => ResumeTemplate)
  template: ResumeTemplate;
}

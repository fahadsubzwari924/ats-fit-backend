import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'resume_templates' })
export class ResumeTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  key: string; // e.g., 'modern-clean', used in S3

  @Column()
  description: string;

  @Column()
  thumbnail_image_url: string;

  @Column()
  remote_url: string;

  @CreateDateColumn()
  created_at: Date;
}

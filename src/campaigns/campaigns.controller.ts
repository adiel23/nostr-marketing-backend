import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from 'src/auth/authenticated-request.interface';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';

@Controller('campaigns')
@UseGuards(JwtAuthGuard)
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Post()
  create(
    @Body() createCampaignDto: CreateCampaignDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.campaignsService.create(createCampaignDto, req.user.id);
  }

  @Get()
  findAll(@Req() req: AuthenticatedRequest) {
    return this.campaignsService.findAll(req.user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.campaignsService.findOne(id, req.user.id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateCampaignDto: UpdateCampaignDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.campaignsService.update(id, updateCampaignDto, req.user.id);
  }

  @Patch(':id/pause')
  pause(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.campaignsService.pause(id, req.user.id);
  }

  @Patch(':id/resume')
  resume(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.campaignsService.resume(id, req.user.id);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.campaignsService.remove(id, req.user.id);
  }
}

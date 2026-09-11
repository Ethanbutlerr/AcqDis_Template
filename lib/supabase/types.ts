export interface Database {
  public: {
    Tables: {
      companies: {
        Row: {
          id: string;
          name: string;
          logo_url: string | null;
          favicon_url: string | null;
          primary_color: string;
          secondary_color: string;
          default_appearance: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          logo_url?: string | null;
          favicon_url?: string | null;
          primary_color?: string;
          secondary_color?: string;
          default_appearance?: string;
        };
        Update: Partial<Database['public']['Tables']['companies']['Insert']>;
      };
      profiles: {
        Row: {
          id: string;
          company_id: string;
          email: string;
          full_name: string;
          avatar_url: string | null;
          timezone: string;
          notification_preferences: Record<string, unknown>;
          is_disabled: boolean;
          last_login_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          company_id: string;
          email: string;
          full_name: string;
          avatar_url?: string | null;
          timezone?: string;
          notification_preferences?: Record<string, unknown>;
          is_disabled?: boolean;
        };
        Update: {
          full_name?: string;
          avatar_url?: string | null;
          timezone?: string;
          notification_preferences?: Record<string, unknown>;
          is_disabled?: boolean;
        };
      };
      teams: {
        Row: {
          id: string;
          company_id: string;
          name: string;
          description: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          name: string;
          description?: string | null;
        };
        Update: {
          name?: string;
          description?: string | null;
        };
      };
      team_members: {
        Row: {
          id: string;
          team_id: string;
          user_id: string;
          role: string;
          created_at: string;
        };
        Insert: {
          team_id: string;
          user_id: string;
          role?: string;
        };
        Update: {
          role?: string;
        };
      };
      roles: {
        Row: {
          id: string;
          company_id: string;
          name: string;
          description: string | null;
          is_system: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          name: string;
          description?: string | null;
          is_system?: boolean;
        };
        Update: {
          name?: string;
          description?: string | null;
        };
      };
      permissions: {
        Row: {
          id: string;
          key: string;
          name: string;
          description: string | null;
          category: string;
          created_at: string;
        };
        Insert: {
          key: string;
          name: string;
          description?: string | null;
          category: string;
        };
      };
      role_permissions: {
        Row: {
          id: string;
          role_id: string;
          permission_id: string;
          created_at: string;
        };
        Insert: {
          role_id: string;
          permission_id: string;
        };
      };
      user_roles: {
        Row: {
          id: string;
          user_id: string;
          role_id: string;
          created_at: string;
        };
        Insert: {
          user_id: string;
          role_id: string;
        };
      };
      audit_logs: {
        Row: {
          id: string;
          user_id: string | null;
          action: string;
          entity_type: string | null;
          entity_id: string | null;
          metadata: Record<string, unknown>;
          created_at: string;
        };
        Insert: {
          user_id?: string | null;
          action: string;
          entity_type?: string | null;
          entity_id?: string | null;
          metadata?: Record<string, unknown>;
        };
      };
      contact_types: {
        Row: {
          id: string;
          company_id: string;
          name: string;
          is_default: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          name: string;
          is_default?: boolean;
        };
        Update: {
          name?: string;
          is_default?: boolean;
        };
      };
      contacts: {
        Row: {
          id: string;
          company_id: string;
          first_name: string | null;
          last_name: string | null;
          company_name: string | null;
          primary_phone: string | null;
          primary_phone_normalized: string | null;
          primary_email: string | null;
          primary_email_normalized: string | null;
          mailing_address_1: string | null;
          mailing_address_2: string | null;
          mailing_city: string | null;
          mailing_state: string | null;
          mailing_zip: string | null;
          assigned_user_id: string | null;
          lead_source: string | null;
          communication_consent: boolean;
          do_not_call: boolean;
          do_not_text: boolean;
          opt_out_date: string | null;
          last_contacted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          first_name?: string | null;
          last_name?: string | null;
          company_name?: string | null;
          primary_phone?: string | null;
          primary_phone_normalized?: string | null;
          primary_email?: string | null;
          primary_email_normalized?: string | null;
          mailing_address_1?: string | null;
          mailing_address_2?: string | null;
          mailing_city?: string | null;
          mailing_state?: string | null;
          mailing_zip?: string | null;
          assigned_user_id?: string | null;
          lead_source?: string | null;
          communication_consent?: boolean;
          do_not_call?: boolean;
          do_not_text?: boolean;
          opt_out_date?: string | null;
          last_contacted_at?: string | null;
        };
        Update: {
          first_name?: string | null;
          last_name?: string | null;
          company_name?: string | null;
          primary_phone?: string | null;
          primary_phone_normalized?: string | null;
          primary_email?: string | null;
          primary_email_normalized?: string | null;
          mailing_address_1?: string | null;
          mailing_address_2?: string | null;
          mailing_city?: string | null;
          mailing_state?: string | null;
          mailing_zip?: string | null;
          assigned_user_id?: string | null;
          lead_source?: string | null;
          communication_consent?: boolean;
          do_not_call?: boolean;
          do_not_text?: boolean;
          opt_out_date?: string | null;
          last_contacted_at?: string | null;
        };
      };
      contact_phones: {
        Row: {
          id: string;
          contact_id: string;
          phone: string;
          phone_normalized: string;
          label: string;
          is_primary: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          contact_id: string;
          phone: string;
          phone_normalized: string;
          label?: string;
          is_primary?: boolean;
        };
        Update: {
          phone?: string;
          phone_normalized?: string;
          label?: string;
          is_primary?: boolean;
        };
      };
      contact_emails: {
        Row: {
          id: string;
          contact_id: string;
          email: string;
          email_normalized: string;
          label: string;
          is_primary: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          contact_id: string;
          email: string;
          email_normalized: string;
          label?: string;
          is_primary?: boolean;
        };
        Update: {
          email?: string;
          email_normalized?: string;
          label?: string;
          is_primary?: boolean;
        };
      };
      contact_contact_types: {
        Row: {
          id: string;
          contact_id: string;
          contact_type_id: string;
          created_at: string;
        };
        Insert: {
          contact_id: string;
          contact_type_id: string;
        };
      };
      tags: {
        Row: {
          id: string;
          company_id: string;
          name: string;
          color: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          name: string;
          color?: string;
        };
        Update: {
          name?: string;
          color?: string;
        };
      };
      contact_tags: {
        Row: {
          id: string;
          contact_id: string;
          tag_id: string;
          created_at: string;
        };
        Insert: {
          contact_id: string;
          tag_id: string;
        };
      };
      properties: {
        Row: {
          id: string;
          company_id: string;
          street_address: string;
          city: string | null;
          state: string | null;
          zip_code: string | null;
          county: string | null;
          property_type: string | null;
          bedrooms: number | null;
          bathrooms: number | null;
          square_footage: number | null;
          lot_size: string | null;
          year_built: number | null;
          occupancy_status: string | null;
          property_condition: string | null;
          repairs_needed: string | null;
          estimated_repair_cost: number | null;
          access_instructions: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          street_address: string;
          city?: string | null;
          state?: string | null;
          zip_code?: string | null;
          county?: string | null;
          property_type?: string | null;
          bedrooms?: number | null;
          bathrooms?: number | null;
          square_footage?: number | null;
          lot_size?: string | null;
          year_built?: number | null;
          occupancy_status?: string | null;
          property_condition?: string | null;
          repairs_needed?: string | null;
          estimated_repair_cost?: number | null;
          access_instructions?: string | null;
        };
        Update: {
          street_address?: string;
          city?: string | null;
          state?: string | null;
          zip_code?: string | null;
          county?: string | null;
          property_type?: string | null;
          bedrooms?: number | null;
          bathrooms?: number | null;
          square_footage?: number | null;
          lot_size?: string | null;
          year_built?: number | null;
          occupancy_status?: string | null;
          property_condition?: string | null;
          repairs_needed?: string | null;
          estimated_repair_cost?: number | null;
          access_instructions?: string | null;
        };
      };
      opportunities: {
        Row: {
          id: string;
          company_id: string;
          primary_seller_contact_id: string | null;
          property_id: string | null;
          lead_source: string | null;
          campaign: string | null;
          referral_source: string | null;
          assigned_acquisition_user_id: string | null;
          assigned_disposition_user_id: string | null;
          priority: string;
          status: string;
          created_at: string;
          contract_date: string | null;
          closing_date: string | null;
          expected_revenue: number | null;
          actual_revenue: number | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          primary_seller_contact_id?: string | null;
          property_id?: string | null;
          lead_source?: string | null;
          campaign?: string | null;
          referral_source?: string | null;
          assigned_acquisition_user_id?: string | null;
          assigned_disposition_user_id?: string | null;
          priority?: string;
          status?: string;
          contract_date?: string | null;
          closing_date?: string | null;
          expected_revenue?: number | null;
          actual_revenue?: number | null;
        };
        Update: {
          primary_seller_contact_id?: string | null;
          property_id?: string | null;
          lead_source?: string | null;
          campaign?: string | null;
          referral_source?: string | null;
          assigned_acquisition_user_id?: string | null;
          assigned_disposition_user_id?: string | null;
          priority?: string;
          status?: string;
          contract_date?: string | null;
          closing_date?: string | null;
          expected_revenue?: number | null;
          actual_revenue?: number | null;
        };
      };
      notes: {
        Row: {
          id: string;
          company_id: string;
          entity_type: string;
          entity_id: string;
          author_id: string | null;
          body: string;
          is_pinned: boolean;
          mentions: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          entity_type: string;
          entity_id: string;
          author_id?: string | null;
          body: string;
          is_pinned?: boolean;
          mentions?: string[];
        };
        Update: {
          body?: string;
          is_pinned?: boolean;
          mentions?: string[];
        };
      };
      files: {
        Row: {
          id: string;
          company_id: string;
          entity_type: string;
          entity_id: string;
          uploaded_by: string | null;
          storage_path: string;
          file_name: string;
          file_type: string;
          file_size: number;
          category: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          entity_type: string;
          entity_id: string;
          uploaded_by?: string | null;
          storage_path: string;
          file_name: string;
          file_type: string;
          file_size?: number;
          category?: string;
        };
      };
      tasks: {
        Row: {
          id: string;
          company_id: string;
          title: string;
          description: string | null;
          status: string;
          priority: string;
          assigned_user_id: string | null;
          assigned_team_id: string | null;
          due_date: string | null;
          due_time: string | null;
          completed_at: string | null;
          related_contact_id: string | null;
          related_property_id: string | null;
          related_opportunity_id: string | null;
          created_by: string | null;
          is_automated: boolean;
          automation_source: string | null;
          recurrence_rule: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          title: string;
          description?: string | null;
          status?: string;
          priority?: string;
          assigned_user_id?: string | null;
          assigned_team_id?: string | null;
          due_date?: string | null;
          due_time?: string | null;
          completed_at?: string | null;
          related_contact_id?: string | null;
          related_property_id?: string | null;
          related_opportunity_id?: string | null;
          created_by?: string | null;
          is_automated?: boolean;
          automation_source?: string | null;
          recurrence_rule?: string | null;
        };
        Update: {
          title?: string;
          description?: string | null;
          status?: string;
          priority?: string;
          assigned_user_id?: string | null;
          assigned_team_id?: string | null;
          due_date?: string | null;
          due_time?: string | null;
          completed_at?: string | null;
          related_contact_id?: string | null;
          related_property_id?: string | null;
          related_opportunity_id?: string | null;
          recurrence_rule?: string | null;
        };
      };
      task_comments: {
        Row: {
          id: string;
          task_id: string;
          author_id: string | null;
          body: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          task_id: string;
          author_id?: string | null;
          body: string;
        };
        Update: {
          body?: string;
        };
      };
      saved_views: {
        Row: {
          id: string;
          company_id: string;
          user_id: string;
          page: string;
          name: string;
          config: Record<string, unknown>;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          user_id: string;
          page: string;
          name: string;
          config?: Record<string, unknown>;
        };
        Update: {
          name?: string;
          config?: Record<string, unknown>;
        };
      };
      activity_events: {
        Row: {
          id: string;
          company_id: string;
          entity_type: string;
          entity_id: string;
          event_type: string;
          actor_id: string | null;
          metadata: Record<string, unknown>;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          entity_type: string;
          entity_id: string;
          event_type: string;
          actor_id?: string | null;
          metadata?: Record<string, unknown>;
        };
      };
      field_groups: {
        Row: {
          id: string;
          company_id: string;
          name: string;
          record_type: string;
          sort_order: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          name: string;
          record_type: string;
          sort_order?: number;
          is_active?: boolean;
        };
        Update: {
          name?: string;
          sort_order?: number;
          is_active?: boolean;
        };
      };
      field_definitions: {
        Row: {
          id: string;
          company_id: string;
          field_group_id: string;
          key: string;
          label: string;
          field_type: string;
          options: Record<string, unknown>;
          is_required: boolean;
          is_active: boolean;
          sort_order: number;
          record_type: string;
          visible_to_roles: string[];
          calculated_expression: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          field_group_id: string;
          key: string;
          label: string;
          field_type: string;
          options?: Record<string, unknown>;
          is_required?: boolean;
          is_active?: boolean;
          sort_order?: number;
          record_type: string;
          visible_to_roles?: string[];
          calculated_expression?: string | null;
        };
        Update: {
          key?: string;
          label?: string;
          field_type?: string;
          options?: Record<string, unknown>;
          is_required?: boolean;
          is_active?: boolean;
          sort_order?: number;
          visible_to_roles?: string[];
          calculated_expression?: string | null;
        };
      };
      field_values: {
        Row: {
          id: string;
          company_id: string;
          field_definition_id: string;
          entity_type: string;
          entity_id: string;
          value: unknown;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          field_definition_id: string;
          entity_type: string;
          entity_id: string;
          value?: unknown;
        };
        Update: {
          value?: unknown;
        };
      };
    };
  };
}

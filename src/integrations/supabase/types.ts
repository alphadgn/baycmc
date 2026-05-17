export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ape_ride_locations: {
        Row: {
          host_id: string
          lat: number
          lng: number
          ride_id: string
          updated_at: string
        }
        Insert: {
          host_id: string
          lat: number
          lng: number
          ride_id: string
          updated_at?: string
        }
        Update: {
          host_id?: string
          lat?: number
          lng?: number
          ride_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ape_ride_locations_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: true
            referencedRelation: "ape_rides"
            referencedColumns: ["id"]
          },
        ]
      }
      ape_ride_requests: {
        Row: {
          created_at: string
          id: string
          message: string | null
          ride_id: string
          status: Database["public"]["Enums"]["ape_ride_request_status"]
          updated_at: string
          viewer_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message?: string | null
          ride_id: string
          status?: Database["public"]["Enums"]["ape_ride_request_status"]
          updated_at?: string
          viewer_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string | null
          ride_id?: string
          status?: Database["public"]["Enums"]["ape_ride_request_status"]
          updated_at?: string
          viewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ape_ride_requests_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "ape_rides"
            referencedColumns: ["id"]
          },
        ]
      }
      ape_rides: {
        Row: {
          created_at: string
          ended_at: string | null
          host_id: string
          id: string
          livekit_room: string
          started_at: string
          status: Database["public"]["Enums"]["ape_ride_status"]
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          host_id: string
          id?: string
          livekit_room: string
          started_at?: string
          status?: Database["public"]["Enums"]["ape_ride_status"]
          title?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          host_id?: string
          id?: string
          livekit_room?: string
          started_at?: string
          status?: Database["public"]["Enums"]["ape_ride_status"]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          id: string
          metadata: Json
          target_id: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          target_id?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          target_id?: string | null
        }
        Relationships: []
      }
      auth_nonces: {
        Row: {
          consumed: boolean
          created_at: string
          expires_at: string
          id: string
          nonce: string
          wallet_address: string
        }
        Insert: {
          consumed?: boolean
          created_at?: string
          expires_at: string
          id?: string
          nonce: string
          wallet_address: string
        }
        Update: {
          consumed?: boolean
          created_at?: string
          expires_at?: string
          id?: string
          nonce?: string
          wallet_address?: string
        }
        Relationships: []
      }
      chapter_submissions: {
        Row: {
          chapter_name: string
          city: string | null
          created_at: string
          id: string
          pitch: string | null
          region: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewer_id: string | null
          status: Database["public"]["Enums"]["chapter_submission_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          chapter_name: string
          city?: string | null
          created_at?: string
          id?: string
          pitch?: string | null
          region?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          status?: Database["public"]["Enums"]["chapter_submission_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          chapter_name?: string
          city?: string | null
          created_at?: string
          id?: string
          pitch?: string | null
          region?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          status?: Database["public"]["Enums"]["chapter_submission_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      lifer_messages: {
        Row: {
          body: string
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      lobby_message_reactions: {
        Row: {
          created_at: string
          emoji: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          message_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lobby_message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "lobby_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      lobby_messages: {
        Row: {
          body: string | null
          created_at: string
          gif_url: string | null
          id: string
          image_url: string | null
          reply_to_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          gif_url?: string | null
          id?: string
          image_url?: string | null
          reply_to_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          gif_url?: string | null
          id?: string
          image_url?: string | null
          reply_to_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lobby_messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "lobby_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          kind: string
          read_at: string | null
          title: string
          url: string | null
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          kind: string
          read_at?: string | null
          title: string
          url?: string | null
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          read_at?: string | null
          title?: string
          url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      otherpage_settings: {
        Row: {
          api_url: string | null
          chain_id: number
          contract_address: string | null
          enabled: boolean
          id: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          api_url?: string | null
          chain_id?: number
          contract_address?: string | null
          enabled?: boolean
          id?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          api_url?: string | null
          chain_id?: number
          contract_address?: string | null
          enabled?: boolean
          id?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      post_comments: {
        Row: {
          body: string
          created_at: string
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_likes: {
        Row: {
          created_at: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          body: string
          created_at: string
          id: string
          image_url: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          image_url?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          image_url?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          id: string
          updated_at: string
          username: string | null
          wallet_address: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          id: string
          updated_at?: string
          username?: string | null
          wallet_address: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          id?: string
          updated_at?: string
          username?: string | null
          wallet_address?: string
        }
        Relationships: []
      }
      room_bookings: {
        Row: {
          created_at: string
          ends_at: string
          id: string
          notes: string | null
          override_by: string | null
          room_id: string
          starts_at: string
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          ends_at: string
          id?: string
          notes?: string | null
          override_by?: string | null
          room_id: string
          starts_at: string
          title: string
          user_id: string
        }
        Update: {
          created_at?: string
          ends_at?: string
          id?: string
          notes?: string | null
          override_by?: string | null
          room_id?: string
          starts_at?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_bookings_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          active: boolean
          capacity: number
          created_at: string
          description: string | null
          id: string
          livekit_room: string
          name: string
          tier: Database["public"]["Enums"]["room_tier"]
        }
        Insert: {
          active?: boolean
          capacity?: number
          created_at?: string
          description?: string | null
          id?: string
          livekit_room: string
          name: string
          tier?: Database["public"]["Enums"]["room_tier"]
        }
        Update: {
          active?: boolean
          capacity?: number
          created_at?: string
          description?: string | null
          id?: string
          livekit_room?: string
          name?: string
          tier?: Database["public"]["Enums"]["room_tier"]
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_verifications: {
        Row: {
          bayc_collection: string | null
          bayc_token_ids: number[]
          bayc_verified: boolean
          delegation_vault: string | null
          delegation_verified: boolean
          id: string
          lumina_verified: boolean
          otherpage_token_ids: number[]
          otherpage_verified: boolean
          updated_at: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          bayc_collection?: string | null
          bayc_token_ids?: number[]
          bayc_verified?: boolean
          delegation_vault?: string | null
          delegation_verified?: boolean
          id?: string
          lumina_verified?: boolean
          otherpage_token_ids?: number[]
          otherpage_verified?: boolean
          updated_at?: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          bayc_collection?: string | null
          bayc_token_ids?: number[]
          bayc_verified?: boolean
          delegation_vault?: string | null
          delegation_verified?: boolean
          id?: string
          lumina_verified?: boolean
          otherpage_token_ids?: number[]
          otherpage_verified?: boolean
          updated_at?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      public_profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string | null
          id: string | null
          updated_at: string | null
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          id?: string | null
          updated_at?: string | null
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          id?: string | null
          updated_at?: string | null
          username?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_lifer: { Args: { _user_id: string }; Returns: boolean }
      is_token_proof_verified: { Args: { _user_id: string }; Returns: boolean }
      is_verified_holder: { Args: { _user_id: string }; Returns: boolean }
      log_audit_event: {
        Args: { _event_type: string; _metadata?: Json; _target_id?: string }
        Returns: string
      }
    }
    Enums: {
      ape_ride_request_status: "pending" | "accepted" | "declined" | "cancelled"
      ape_ride_status: "live" | "ended"
      app_role: "super_admin" | "admin" | "verified_user" | "chapter_leader"
      chapter_submission_status: "pending" | "approved" | "rejected"
      room_tier: "token_proof" | "lifer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      ape_ride_request_status: ["pending", "accepted", "declined", "cancelled"],
      ape_ride_status: ["live", "ended"],
      app_role: ["super_admin", "admin", "verified_user", "chapter_leader"],
      chapter_submission_status: ["pending", "approved", "rejected"],
      room_tier: ["token_proof", "lifer"],
    },
  },
} as const

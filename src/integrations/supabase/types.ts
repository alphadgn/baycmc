export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      account_merge_decisions: {
        Row: {
          decided_at: string;
          decided_by: string;
          decision: string;
          user_a_id: string;
          user_b_id: string;
        };
        Insert: {
          decided_at?: string;
          decided_by: string;
          decision: string;
          user_a_id: string;
          user_b_id: string;
        };
        Update: {
          decided_at?: string;
          decided_by?: string;
          decision?: string;
          user_a_id?: string;
          user_b_id?: string;
        };
        Relationships: [];
      };
      ape_ride_locations: {
        Row: {
          host_id: string;
          lat: number;
          lng: number;
          ride_id: string;
          updated_at: string;
        };
        Insert: {
          host_id: string;
          lat: number;
          lng: number;
          ride_id: string;
          updated_at?: string;
        };
        Update: {
          host_id?: string;
          lat?: number;
          lng?: number;
          ride_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ape_ride_locations_ride_id_fkey";
            columns: ["ride_id"];
            isOneToOne: true;
            referencedRelation: "ape_rides";
            referencedColumns: ["id"];
          },
        ];
      };
      ape_ride_payments: {
        Row: {
          amount_wei: number;
          chain_id: number;
          created_at: string;
          from_address: string;
          host_id: string;
          id: string;
          payer_id: string;
          reservation_id: string;
          ride_id: string;
          to_address: string;
          tx_hash: string;
        };
        Insert: {
          amount_wei: number;
          chain_id: number;
          created_at?: string;
          from_address: string;
          host_id: string;
          id?: string;
          payer_id: string;
          reservation_id: string;
          ride_id: string;
          to_address: string;
          tx_hash: string;
        };
        Update: {
          amount_wei?: number;
          chain_id?: number;
          created_at?: string;
          from_address?: string;
          host_id?: string;
          id?: string;
          payer_id?: string;
          reservation_id?: string;
          ride_id?: string;
          to_address?: string;
          tx_hash?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ape_ride_payments_reservation_id_fkey";
            columns: ["reservation_id"];
            isOneToOne: false;
            referencedRelation: "ape_ride_reservations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ape_ride_payments_ride_id_fkey";
            columns: ["ride_id"];
            isOneToOne: false;
            referencedRelation: "ape_rides";
            referencedColumns: ["id"];
          },
        ];
      };
      ape_ride_requests: {
        Row: {
          created_at: string;
          id: string;
          message: string | null;
          ride_id: string;
          status: Database["public"]["Enums"]["ape_ride_request_status"];
          updated_at: string;
          viewer_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          message?: string | null;
          ride_id: string;
          status?: Database["public"]["Enums"]["ape_ride_request_status"];
          updated_at?: string;
          viewer_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          message?: string | null;
          ride_id?: string;
          status?: Database["public"]["Enums"]["ape_ride_request_status"];
          updated_at?: string;
          viewer_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ape_ride_requests_ride_id_fkey";
            columns: ["ride_id"];
            isOneToOne: false;
            referencedRelation: "ape_rides";
            referencedColumns: ["id"];
          },
        ];
      };
      ape_ride_reservations: {
        Row: {
          cancelled_by: string | null;
          created_at: string;
          id: string;
          price_ape: number;
          ride_id: string;
          status: string;
          updated_at: string;
          viewer_id: string;
        };
        Insert: {
          cancelled_by?: string | null;
          created_at?: string;
          id?: string;
          price_ape?: number;
          ride_id: string;
          status?: string;
          updated_at?: string;
          viewer_id: string;
        };
        Update: {
          cancelled_by?: string | null;
          created_at?: string;
          id?: string;
          price_ape?: number;
          ride_id?: string;
          status?: string;
          updated_at?: string;
          viewer_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ape_ride_reservations_ride_id_fkey";
            columns: ["ride_id"];
            isOneToOne: false;
            referencedRelation: "ape_rides";
            referencedColumns: ["id"];
          },
        ];
      };
      ape_ride_venues: {
        Row: {
          active: boolean;
          created_at: string;
          display_order: number;
          lat: number;
          lng: number;
          name: string;
          radius_m: number;
          slug: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          display_order?: number;
          lat: number;
          lng: number;
          name: string;
          radius_m: number;
          slug: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          display_order?: number;
          lat?: number;
          lng?: number;
          name?: string;
          radius_m?: number;
          slug?: string;
        };
        Relationships: [];
      };
      ape_rides: {
        Row: {
          admin_override: boolean;
          cancel_reason: string | null;
          cancelled_by: string | null;
          capacity: number;
          created_at: string;
          ended_at: string | null;
          granted_by: string | null;
          host_id: string;
          id: string;
          livekit_room: string;
          price_ape: number;
          scheduled_end: string | null;
          scheduled_start: string | null;
          started_at: string;
          status: Database["public"]["Enums"]["ape_ride_status"];
          title: string;
          updated_at: string;
          venue_slug: string | null;
        };
        Insert: {
          admin_override?: boolean;
          cancel_reason?: string | null;
          cancelled_by?: string | null;
          capacity?: number;
          created_at?: string;
          ended_at?: string | null;
          granted_by?: string | null;
          host_id: string;
          id?: string;
          livekit_room: string;
          price_ape?: number;
          scheduled_end?: string | null;
          scheduled_start?: string | null;
          started_at?: string;
          status?: Database["public"]["Enums"]["ape_ride_status"];
          title?: string;
          updated_at?: string;
          venue_slug?: string | null;
        };
        Update: {
          admin_override?: boolean;
          cancel_reason?: string | null;
          cancelled_by?: string | null;
          capacity?: number;
          created_at?: string;
          ended_at?: string | null;
          granted_by?: string | null;
          host_id?: string;
          id?: string;
          livekit_room?: string;
          price_ape?: number;
          scheduled_end?: string | null;
          scheduled_start?: string | null;
          started_at?: string;
          status?: Database["public"]["Enums"]["ape_ride_status"];
          title?: string;
          updated_at?: string;
          venue_slug?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "ape_rides_venue_slug_fkey";
            columns: ["venue_slug"];
            isOneToOne: false;
            referencedRelation: "ape_ride_venues";
            referencedColumns: ["slug"];
          },
        ];
      };
      app_settings: {
        Row: {
          key: string;
          updated_at: string;
          updated_by: string | null;
          value: Json;
        };
        Insert: {
          key: string;
          updated_at?: string;
          updated_by?: string | null;
          value?: Json;
        };
        Update: {
          key?: string;
          updated_at?: string;
          updated_by?: string | null;
          value?: Json;
        };
        Relationships: [];
      };
      audit_logs: {
        Row: {
          actor_id: string | null;
          created_at: string;
          event_type: string;
          id: string;
          metadata: Json;
          target_id: string | null;
        };
        Insert: {
          actor_id?: string | null;
          created_at?: string;
          event_type: string;
          id?: string;
          metadata?: Json;
          target_id?: string | null;
        };
        Update: {
          actor_id?: string | null;
          created_at?: string;
          event_type?: string;
          id?: string;
          metadata?: Json;
          target_id?: string | null;
        };
        Relationships: [];
      };
      auth_nonces: {
        Row: {
          consumed: boolean;
          created_at: string;
          expires_at: string;
          id: string;
          nonce: string;
          wallet_address: string;
        };
        Insert: {
          consumed?: boolean;
          created_at?: string;
          expires_at: string;
          id?: string;
          nonce: string;
          wallet_address: string;
        };
        Update: {
          consumed?: boolean;
          created_at?: string;
          expires_at?: string;
          id?: string;
          nonce?: string;
          wallet_address?: string;
        };
        Relationships: [];
      };
      chapter_submissions: {
        Row: {
          chapter_name: string;
          city: string | null;
          created_at: string;
          id: string;
          pitch: string | null;
          region: string | null;
          review_notes: string | null;
          reviewed_at: string | null;
          reviewer_id: string | null;
          status: Database["public"]["Enums"]["chapter_submission_status"];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          chapter_name: string;
          city?: string | null;
          created_at?: string;
          id?: string;
          pitch?: string | null;
          region?: string | null;
          review_notes?: string | null;
          reviewed_at?: string | null;
          reviewer_id?: string | null;
          status?: Database["public"]["Enums"]["chapter_submission_status"];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          chapter_name?: string;
          city?: string | null;
          created_at?: string;
          id?: string;
          pitch?: string | null;
          region?: string | null;
          review_notes?: string | null;
          reviewed_at?: string | null;
          reviewer_id?: string | null;
          status?: Database["public"]["Enums"]["chapter_submission_status"];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      collection_menu_items: {
        Row: {
          collection_label: string;
          enabled: boolean;
          item_key: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          collection_label: string;
          enabled?: boolean;
          item_key: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          collection_label?: string;
          enabled?: boolean;
          item_key?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      contract_audit_messages: {
        Row: {
          created_at: string;
          id: string;
          parts: Json;
          role: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          parts: Json;
          role: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          parts?: Json;
          role?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      event_stream_hosts: {
        Row: {
          assigned_by: string | null;
          created_at: string;
          user_id: string;
        };
        Insert: {
          assigned_by?: string | null;
          created_at?: string;
          user_id: string;
        };
        Update: {
          assigned_by?: string | null;
          created_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      lifer_grants: {
        Row: { created_at: string; granted_by: string | null; user_id: string };
        Insert: { created_at?: string; granted_by?: string | null; user_id: string };
        Update: { created_at?: string; granted_by?: string | null; user_id?: string };
        Relationships: [];
      };
      karaoke_backing_tracks: {
        Row: {
          artist: string | null;
          created_at: string;
          duration_ms: number | null;
          id: string;
          is_public: boolean;
          lyrics: string | null;
          mime_type: string;
          owner_id: string;
          size_bytes: number;
          storage_path: string;
          title: string;
        };
        Insert: {
          artist?: string | null;
          created_at?: string;
          duration_ms?: number | null;
          id?: string;
          is_public?: boolean;
          lyrics?: string | null;
          mime_type: string;
          owner_id: string;
          size_bytes: number;
          storage_path: string;
          title: string;
        };
        Update: {
          artist?: string | null;
          created_at?: string;
          duration_ms?: number | null;
          id?: string;
          is_public?: boolean;
          lyrics?: string | null;
          mime_type?: string;
          owner_id?: string;
          size_bytes?: number;
          storage_path?: string;
          title?: string;
        };
        Relationships: [];
      };
      karaoke_presence: {
        Row: {
          last_seen_at: string;
          room_id: string;
          user_id: string;
        };
        Insert: {
          last_seen_at?: string;
          room_id: string;
          user_id: string;
        };
        Update: {
          last_seen_at?: string;
          room_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "karaoke_presence_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      karaoke_queue: {
        Row: {
          id: string;
          joined_at: string;
          last_seen_at: string;
          room_id: string;
          user_id: string;
        };
        Insert: {
          id?: string;
          joined_at?: string;
          last_seen_at?: string;
          room_id: string;
          user_id: string;
        };
        Update: {
          id?: string;
          joined_at?: string;
          last_seen_at?: string;
          room_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "karaoke_queue_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      karaoke_recordings: {
        Row: {
          backing_track_id: string | null;
          created_at: string;
          duration_ms: number | null;
          has_instrumental: boolean;
          id: string;
          mime_type: string;
          performer_id: string;
          public_url: string;
          reservation_id: string | null;
          room_id: string;
          session_generation: number | null;
          song_artist: string | null;
          song_title: string | null;
          storage_path: string;
          updated_at: string;
          visibility: string;
          youtube_id: string | null;
        };
        Insert: {
          backing_track_id?: string | null;
          created_at?: string;
          duration_ms?: number | null;
          has_instrumental?: boolean;
          id?: string;
          mime_type?: string;
          performer_id: string;
          public_url: string;
          reservation_id?: string | null;
          room_id: string;
          session_generation?: number | null;
          song_artist?: string | null;
          song_title?: string | null;
          storage_path: string;
          updated_at?: string;
          visibility?: string;
          youtube_id?: string | null;
        };
        Update: {
          backing_track_id?: string | null;
          created_at?: string;
          duration_ms?: number | null;
          has_instrumental?: boolean;
          id?: string;
          mime_type?: string;
          performer_id?: string;
          public_url?: string;
          reservation_id?: string | null;
          room_id?: string;
          session_generation?: number | null;
          song_artist?: string | null;
          song_title?: string | null;
          storage_path?: string;
          updated_at?: string;
          visibility?: string;
          youtube_id?: string | null;
        };
        Relationships: [];
      };
      karaoke_reservations: {
        Row: {
          backing_track_id: string | null;
          booked_by: string;
          created_at: string;
          ends_at: string;
          id: string;
          notes: string | null;
          room_id: string;
          singer_user_id: string;
          song_artist: string | null;
          song_title: string | null;
          starts_at: string;
          status: string;
          video_id: string | null;
        };
        Insert: {
          backing_track_id?: string | null;
          booked_by: string;
          created_at?: string;
          ends_at: string;
          id?: string;
          notes?: string | null;
          room_id: string;
          singer_user_id: string;
          song_artist?: string | null;
          song_title?: string | null;
          starts_at: string;
          status?: string;
          video_id?: string | null;
        };
        Update: {
          backing_track_id?: string | null;
          booked_by?: string;
          created_at?: string;
          ends_at?: string;
          id?: string;
          notes?: string | null;
          room_id?: string;
          singer_user_id?: string;
          song_artist?: string | null;
          song_title?: string | null;
          starts_at?: string;
          status?: string;
          video_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "karaoke_reservations_backing_track_id_fkey";
            columns: ["backing_track_id"];
            isOneToOne: false;
            referencedRelation: "karaoke_backing_tracks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "karaoke_reservations_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      karaoke_room_sanctions: {
        Row: {
          created_at: string;
          created_by: string;
          expires_at: string | null;
          id: string;
          kind: string;
          lifted_at: string | null;
          lifted_by: string | null;
          reason: string | null;
          room_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          expires_at?: string | null;
          id?: string;
          kind: string;
          lifted_at?: string | null;
          lifted_by?: string | null;
          reason?: string | null;
          room_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          expires_at?: string | null;
          id?: string;
          kind?: string;
          lifted_at?: string | null;
          lifted_by?: string | null;
          reason?: string | null;
          room_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "karaoke_room_sanctions_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      karaoke_room_settings: {
        Row: {
          allow_uploads: boolean;
          allow_youtube: boolean;
          booking_window_days: number;
          holders_priority: boolean;
          max_future_bookings: number;
          max_slot_minutes: number;
          max_song_seconds: number;
          recording_enabled: boolean;
          require_booking: boolean;
          room_id: string;
          rules: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          allow_uploads?: boolean;
          allow_youtube?: boolean;
          booking_window_days?: number;
          holders_priority?: boolean;
          max_future_bookings?: number;
          max_slot_minutes?: number;
          max_song_seconds?: number;
          recording_enabled?: boolean;
          require_booking?: boolean;
          room_id: string;
          rules?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          allow_uploads?: boolean;
          allow_youtube?: boolean;
          booking_window_days?: number;
          holders_priority?: boolean;
          max_future_bookings?: number;
          max_slot_minutes?: number;
          max_song_seconds?: number;
          recording_enabled?: boolean;
          require_booking?: boolean;
          room_id?: string;
          rules?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "karaoke_room_settings_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: true;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      karaoke_search_cache: {
        Row: {
          fetched_at: string;
          id: string;
          query: string;
          results: Json;
        };
        Insert: {
          fetched_at?: string;
          id?: string;
          query: string;
          results?: Json;
        };
        Update: {
          fetched_at?: string;
          id?: string;
          query?: string;
          results?: Json;
        };
        Relationships: [];
      };
      karaoke_sessions: {
        Row: {
          backing_track_id: string | null;
          generation: number;
          performer_heartbeat_at: string | null;
          performer_user_id: string | null;
          playback_status: string;
          position_at: string;
          position_ms: number;
          reservation_id: string | null;
          revision: number;
          room_id: string;
          search_query: string | null;
          song_artist: string | null;
          song_title: string | null;
          stage_source: string;
          updated_at: string;
          video_id: string | null;
        };
        Insert: {
          backing_track_id?: string | null;
          generation?: number;
          performer_heartbeat_at?: string | null;
          performer_user_id?: string | null;
          playback_status?: string;
          position_at?: string;
          position_ms?: number;
          reservation_id?: string | null;
          revision?: number;
          room_id: string;
          search_query?: string | null;
          song_artist?: string | null;
          song_title?: string | null;
          stage_source?: string;
          updated_at?: string;
          video_id?: string | null;
        };
        Update: {
          backing_track_id?: string | null;
          generation?: number;
          performer_heartbeat_at?: string | null;
          performer_user_id?: string | null;
          playback_status?: string;
          position_at?: string;
          position_ms?: number;
          reservation_id?: string | null;
          revision?: number;
          room_id?: string;
          search_query?: string | null;
          song_artist?: string | null;
          song_title?: string | null;
          stage_source?: string;
          updated_at?: string;
          video_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "karaoke_sessions_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: true;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      karaoke_songs: {
        Row: {
          artist: string | null;
          created_at: string;
          id: string;
          normalized_title: string;
          playable_url: string | null;
          rank: number | null;
          source: string;
          title: string;
          updated_at: string;
          youtube_id: string | null;
        };
        Insert: {
          artist?: string | null;
          created_at?: string;
          id?: string;
          normalized_title: string;
          playable_url?: string | null;
          rank?: number | null;
          source?: string;
          title: string;
          updated_at?: string;
          youtube_id?: string | null;
        };
        Update: {
          artist?: string | null;
          created_at?: string;
          id?: string;
          normalized_title?: string;
          playable_url?: string | null;
          rank?: number | null;
          source?: string;
          title?: string;
          updated_at?: string;
          youtube_id?: string | null;
        };
        Relationships: [];
      };
      karaoke_tips: {
        Row: {
          amount_wei: number;
          chain_id: number;
          created_at: string;
          from_address: string;
          id: string;
          recipient_id: string;
          room_id: string;
          session_generation: number | null;
          tipper_id: string;
          to_address: string;
          tx_hash: string;
        };
        Insert: {
          amount_wei: number;
          chain_id?: number;
          created_at?: string;
          from_address: string;
          id?: string;
          recipient_id: string;
          room_id: string;
          session_generation?: number | null;
          tipper_id: string;
          to_address: string;
          tx_hash: string;
        };
        Update: {
          amount_wei?: number;
          chain_id?: number;
          created_at?: string;
          from_address?: string;
          id?: string;
          recipient_id?: string;
          room_id?: string;
          session_generation?: number | null;
          tipper_id?: string;
          to_address?: string;
          tx_hash?: string;
        };
        Relationships: [
          {
            foreignKeyName: "karaoke_tips_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      karaoke_video_status: {
        Row: {
          checked_at: string;
          embeddable: boolean;
          reason: string | null;
          youtube_id: string;
        };
        Insert: {
          checked_at?: string;
          embeddable: boolean;
          reason?: string | null;
          youtube_id: string;
        };
        Update: {
          checked_at?: string;
          embeddable?: boolean;
          reason?: string | null;
          youtube_id?: string;
        };
        Relationships: [];
      };
      lifer_messages: {
        Row: {
          body: string | null;
          created_at: string;
          gif_url: string | null;
          id: string;
          image_url: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          body?: string | null;
          created_at?: string;
          gif_url?: string | null;
          id?: string;
          image_url?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          body?: string | null;
          created_at?: string;
          gif_url?: string | null;
          id?: string;
          image_url?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      linked_wallets: {
        Row: {
          address: string;
          created_at: string;
          id: string;
          label: string | null;
          last_checked_at: string | null;
          user_id: string;
          verified_at: string | null;
        };
        Insert: {
          address: string;
          created_at?: string;
          id?: string;
          label?: string | null;
          last_checked_at?: string | null;
          user_id: string;
          verified_at?: string | null;
        };
        Update: {
          address?: string;
          created_at?: string;
          id?: string;
          label?: string | null;
          last_checked_at?: string | null;
          user_id?: string;
          verified_at?: string | null;
        };
        Relationships: [];
      };
      lobby_message_reactions: {
        Row: {
          created_at: string;
          emoji: string;
          message_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          emoji: string;
          message_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          emoji?: string;
          message_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "lobby_message_reactions_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "lobby_messages";
            referencedColumns: ["id"];
          },
        ];
      };
      local_chapters: {
        Row: {
          id: string;
          name: string;
          display_order: number;
          active: boolean;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          display_order?: number;
          active?: boolean;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          display_order?: number;
          active?: boolean;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      chapter_meetings: {
        Row: {
          id: string;
          chapter_id: string;
          requester_id: string;
          room_id: string;
          starts_at: string;
          ends_at: string;
          expected_capacity: number;
          notes: string | null;
          status: string;
          leader_labels: string[];
          reviewed_by: string | null;
          reviewed_at: string | null;
          review_note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          chapter_id: string;
          requester_id: string;
          room_id: string;
          starts_at: string;
          ends_at: string;
          expected_capacity: number;
          notes?: string | null;
          status?: string;
          leader_labels?: string[];
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          review_note?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          chapter_id?: string;
          requester_id?: string;
          room_id?: string;
          starts_at?: string;
          ends_at?: string;
          expected_capacity?: number;
          notes?: string | null;
          status?: string;
          leader_labels?: string[];
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          review_note?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      chapter_meeting_attendees: {
        Row: {
          meeting_id: string;
          user_id: string;
          added_by: string | null;
          created_at: string;
        };
        Insert: {
          meeting_id: string;
          user_id: string;
          added_by?: string | null;
          created_at?: string;
        };
        Update: {
          meeting_id?: string;
          user_id?: string;
          added_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      chapter_meeting_attendance: {
        Row: {
          meeting_id: string;
          user_id: string;
          first_joined_at: string;
          last_seen_at: string;
        };
        Insert: {
          meeting_id: string;
          user_id: string;
          first_joined_at?: string;
          last_seen_at?: string;
        };
        Update: {
          meeting_id?: string;
          user_id?: string;
          first_joined_at?: string;
          last_seen_at?: string;
        };
        Relationships: [];
      };
      member_holdings: {
        Row: {
          user_id: string;
          labels: string[];
          verified_at: string;
        };
        Insert: {
          user_id: string;
          labels?: string[];
          verified_at?: string;
        };
        Update: {
          user_id?: string;
          labels?: string[];
          verified_at?: string;
        };
        Relationships: [];
      };
      lobby_messages: {
        Row: {
          body: string | null;
          channel: string;
          created_at: string;
          gif_url: string | null;
          id: string;
          image_url: string | null;
          reply_to_id: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          body?: string | null;
          channel?: string;
          created_at?: string;
          gif_url?: string | null;
          id?: string;
          image_url?: string | null;
          reply_to_id?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          body?: string | null;
          channel?: string;
          created_at?: string;
          gif_url?: string | null;
          id?: string;
          image_url?: string | null;
          reply_to_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "lobby_messages_reply_to_id_fkey";
            columns: ["reply_to_id"];
            isOneToOne: false;
            referencedRelation: "lobby_messages";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          body: string;
          created_at: string;
          id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          id?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      mudwater_actions: {
        Row: {
          action_id: string;
          actor: string;
          captured: number[];
          card: number | null;
          created_at: string;
          ended: boolean;
          kind: string;
          match_id: string;
          move_number: number;
          seat: number;
          square: number | null;
        };
        Insert: {
          action_id: string;
          actor: string;
          captured?: number[];
          card?: number | null;
          created_at?: string;
          ended?: boolean;
          kind: string;
          match_id: string;
          move_number: number;
          seat: number;
          square?: number | null;
        };
        Update: {
          action_id?: string;
          actor?: string;
          captured?: number[];
          card?: number | null;
          created_at?: string;
          ended?: boolean;
          kind?: string;
          match_id?: string;
          move_number?: number;
          seat?: number;
          square?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "mudwater_actions_match_id_fkey";
            columns: ["match_id"];
            isOneToOne: false;
            referencedRelation: "mudwater_matches";
            referencedColumns: ["id"];
          },
        ];
      };
      mudwater_matches: {
        Row: {
          advanced: boolean;
          agent_policy: string | null;
          catalog_version: string;
          created_at: string;
          created_by: string | null;
          end_reason: string | null;
          finished_at: string | null;
          id: string;
          mode: string;
          public_state: Json | null;
          rematch_of: string | null;
          required_collection: string | null;
          room_id: string;
          room_name: string;
          room_slug: string;
          rules_version: string;
          scores: number[] | null;
          started_at: string | null;
          starting_seat: number | null;
          status: string;
          turn_deadline: string | null;
          turn_seconds: number;
          updated_at: string;
          version: number;
          winner_seat: number | null;
        };
        Insert: {
          advanced?: boolean;
          agent_policy?: string | null;
          catalog_version: string;
          created_at?: string;
          created_by?: string | null;
          end_reason?: string | null;
          finished_at?: string | null;
          id?: string;
          mode: string;
          public_state?: Json | null;
          rematch_of?: string | null;
          required_collection?: string | null;
          room_id: string;
          room_name: string;
          room_slug: string;
          rules_version: string;
          scores?: number[] | null;
          started_at?: string | null;
          starting_seat?: number | null;
          status?: string;
          turn_deadline?: string | null;
          turn_seconds?: number;
          updated_at?: string;
          version?: number;
          winner_seat?: number | null;
        };
        Update: {
          advanced?: boolean;
          agent_policy?: string | null;
          catalog_version?: string;
          created_at?: string;
          created_by?: string | null;
          end_reason?: string | null;
          finished_at?: string | null;
          id?: string;
          mode?: string;
          public_state?: Json | null;
          rematch_of?: string | null;
          required_collection?: string | null;
          room_id?: string;
          room_name?: string;
          room_slug?: string;
          rules_version?: string;
          scores?: number[] | null;
          started_at?: string | null;
          starting_seat?: number | null;
          status?: string;
          turn_deadline?: string | null;
          turn_seconds?: number;
          updated_at?: string;
          version?: number;
          winner_seat?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "mudwater_matches_rematch_of_fkey";
            columns: ["rematch_of"];
            isOneToOne: false;
            referencedRelation: "mudwater_matches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mudwater_matches_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      mudwater_seat_private: {
        Row: {
          deck: number[];
          hand: number[];
          match_id: string;
          rocks: Json;
          seat: number;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          deck?: number[];
          hand?: number[];
          match_id: string;
          rocks?: Json;
          seat: number;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          deck?: number[];
          hand?: number[];
          match_id?: string;
          rocks?: Json;
          seat?: number;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "mudwater_seat_private_match_id_fkey";
            columns: ["match_id"];
            isOneToOne: false;
            referencedRelation: "mudwater_matches";
            referencedColumns: ["id"];
          },
        ];
      };
      mudwater_seats: {
        Row: {
          active: boolean;
          avatar_url: string | null;
          display_name: string;
          is_agent: boolean;
          joined_at: string;
          last_seen_at: string;
          match_id: string;
          ready: boolean;
          seat: number;
          user_id: string | null;
        };
        Insert: {
          active?: boolean;
          avatar_url?: string | null;
          display_name: string;
          is_agent?: boolean;
          joined_at?: string;
          last_seen_at?: string;
          match_id: string;
          ready?: boolean;
          seat: number;
          user_id?: string | null;
        };
        Update: {
          active?: boolean;
          avatar_url?: string | null;
          display_name?: string;
          is_agent?: boolean;
          joined_at?: string;
          last_seen_at?: string;
          match_id?: string;
          ready?: boolean;
          seat?: number;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "mudwater_seats_match_id_fkey";
            columns: ["match_id"];
            isOneToOne: false;
            referencedRelation: "mudwater_matches";
            referencedColumns: ["id"];
          },
        ];
      };
      mudwater_state: {
        Row: {
          match_id: string;
          state: Json;
          updated_at: string;
        };
        Insert: {
          match_id: string;
          state: Json;
          updated_at?: string;
        };
        Update: {
          match_id?: string;
          state?: Json;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "mudwater_state_match_id_fkey";
            columns: ["match_id"];
            isOneToOne: true;
            referencedRelation: "mudwater_matches";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          body: string | null;
          created_at: string;
          id: string;
          kind: string;
          read_at: string | null;
          title: string;
          url: string | null;
          user_id: string;
        };
        Insert: {
          body?: string | null;
          created_at?: string;
          id?: string;
          kind: string;
          read_at?: string | null;
          title: string;
          url?: string | null;
          user_id: string;
        };
        Update: {
          body?: string | null;
          created_at?: string;
          id?: string;
          kind?: string;
          read_at?: string | null;
          title?: string;
          url?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      otherpage_settings: {
        Row: {
          api_url: string | null;
          chain_id: number;
          contract_address: string | null;
          enabled: boolean;
          id: number;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          api_url?: string | null;
          chain_id?: number;
          contract_address?: string | null;
          enabled?: boolean;
          id?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          api_url?: string | null;
          chain_id?: number;
          contract_address?: string | null;
          enabled?: boolean;
          id?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      post_comments: {
        Row: {
          body: string;
          created_at: string;
          id: string;
          post_id: string;
          user_id: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          id?: string;
          post_id: string;
          user_id: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          id?: string;
          post_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "post_comments_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id"];
          },
        ];
      };
      post_likes: {
        Row: {
          created_at: string;
          post_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          post_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          post_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "post_likes_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id"];
          },
        ];
      };
      posts: {
        Row: {
          body: string;
          created_at: string;
          id: string;
          image_url: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          id?: string;
          image_url?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          id?: string;
          image_url?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          bio: string | null;
          created_at: string;
          id: string;
          linked_wallets: string[];
          updated_at: string;
          username: string | null;
          wallet_address: string | null;
          wallet_display: string | null;
        };
        Insert: {
          avatar_url?: string | null;
          bio?: string | null;
          created_at?: string;
          id: string;
          linked_wallets?: string[];
          updated_at?: string;
          username?: string | null;
          wallet_address?: string | null;
          wallet_display?: string | null;
        };
        Update: {
          avatar_url?: string | null;
          bio?: string | null;
          created_at?: string;
          id?: string;
          linked_wallets?: string[];
          updated_at?: string;
          username?: string | null;
          wallet_address?: string | null;
          wallet_display?: string | null;
        };
        Relationships: [];
      };
      room_booking_guests: {
        Row: {
          booking_id: string;
          decided_at: string | null;
          decided_by: string | null;
          requested_at: string;
          status: string;
          user_id: string;
        };
        Insert: {
          booking_id: string;
          decided_at?: string | null;
          decided_by?: string | null;
          requested_at?: string;
          status?: string;
          user_id: string;
        };
        Update: {
          booking_id?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          requested_at?: string;
          status?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "room_booking_guests_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "room_bookings";
            referencedColumns: ["id"];
          },
        ];
      };
      room_bookings: {
        Row: {
          created_at: string;
          ends_at: string;
          id: string;
          notes: string | null;
          override_by: string | null;
          room_id: string;
          starts_at: string;
          title: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          ends_at: string;
          id?: string;
          notes?: string | null;
          override_by?: string | null;
          room_id: string;
          starts_at: string;
          title: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          ends_at?: string;
          id?: string;
          notes?: string | null;
          override_by?: string | null;
          room_id?: string;
          starts_at?: string;
          title?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "room_bookings_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      rooms: {
        Row: {
          active: boolean;
          capacity: number;
          coming_soon: boolean;
          created_at: string;
          description: string | null;
          display_order: number | null;
          id: string;
          is_locked: boolean;
          kind: string;
          livekit_room: string;
          name: string;
          required_collection: string | null;
          slug: string | null;
          theme: string | null;
          tier: Database["public"]["Enums"]["room_tier"];
        };
        Insert: {
          active?: boolean;
          capacity?: number;
          coming_soon?: boolean;
          created_at?: string;
          description?: string | null;
          display_order?: number | null;
          id?: string;
          is_locked?: boolean;
          kind?: string;
          livekit_room: string;
          name: string;
          required_collection?: string | null;
          slug?: string | null;
          theme?: string | null;
          tier?: Database["public"]["Enums"]["room_tier"];
        };
        Update: {
          active?: boolean;
          capacity?: number;
          coming_soon?: boolean;
          created_at?: string;
          description?: string | null;
          display_order?: number | null;
          id?: string;
          is_locked?: boolean;
          kind?: string;
          livekit_room?: string;
          name?: string;
          required_collection?: string | null;
          slug?: string | null;
          theme?: string | null;
          tier?: Database["public"]["Enums"]["room_tier"];
        };
        Relationships: [];
      };
      security_scan_findings: {
        Row: {
          category: string;
          created_at: string;
          id: string;
          message: string;
          metadata: Json;
          resolved: boolean;
          severity: string;
        };
        Insert: {
          category: string;
          created_at?: string;
          id?: string;
          message: string;
          metadata?: Json;
          resolved?: boolean;
          severity: string;
        };
        Update: {
          category?: string;
          created_at?: string;
          id?: string;
          message?: string;
          metadata?: Json;
          resolved?: boolean;
          severity?: string;
        };
        Relationships: [];
      };
      session_wallets: {
        Row: {
          address: string;
          proven_at: string;
          user_id: string;
        };
        Insert: {
          address: string;
          proven_at?: string;
          user_id: string;
        };
        Update: {
          address?: string;
          proven_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      support_messages: {
        Row: {
          body: string;
          created_at: string;
          id: string;
          is_admin: boolean;
          sender_id: string;
          thread_user_id: string;
          updated_at: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          id?: string;
          is_admin?: boolean;
          sender_id: string;
          thread_user_id: string;
          updated_at?: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          id?: string;
          is_admin?: boolean;
          sender_id?: string;
          thread_user_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
      user_verifications: {
        Row: {
          bayc_collection: string | null;
          bayc_token_ids: number[];
          bayc_verified: boolean;
          delegation_vault: string | null;
          delegation_verified: boolean;
          id: string;
          lumina_verified: boolean;
          otherpage_token_ids: number[];
          otherpage_verified: boolean;
          updated_at: string;
          user_id: string;
          verified_at: string | null;
          verified_collections: string[];
        };
        Insert: {
          bayc_collection?: string | null;
          bayc_token_ids?: number[];
          bayc_verified?: boolean;
          delegation_vault?: string | null;
          delegation_verified?: boolean;
          id?: string;
          lumina_verified?: boolean;
          otherpage_token_ids?: number[];
          otherpage_verified?: boolean;
          updated_at?: string;
          user_id: string;
          verified_at?: string | null;
          verified_collections?: string[];
        };
        Update: {
          bayc_collection?: string | null;
          bayc_token_ids?: number[];
          bayc_verified?: boolean;
          delegation_vault?: string | null;
          delegation_verified?: boolean;
          id?: string;
          lumina_verified?: boolean;
          otherpage_token_ids?: number[];
          otherpage_verified?: boolean;
          updated_at?: string;
          user_id?: string;
          verified_at?: string | null;
          verified_collections?: string[];
        };
        Relationships: [];
      };
    };
    Views: {
      public_profiles: {
        Row: {
          avatar_url: string | null;
          bio: string | null;
          created_at: string | null;
          id: string | null;
          updated_at: string | null;
          username: string | null;
        };
        Insert: {
          avatar_url?: string | null;
          bio?: string | null;
          created_at?: string | null;
          id?: string | null;
          updated_at?: string | null;
          username?: string | null;
        };
        Update: {
          avatar_url?: string | null;
          bio?: string | null;
          created_at?: string | null;
          id?: string | null;
          updated_at?: string | null;
          username?: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      member_profiles: {
        Args: never;
        Returns: {
          id: string;
          username: string | null;
          avatar_url: string | null;
          bio: string | null;
          wallet_display: string | null;
          created_at: string;
          updated_at: string;
        }[];
      };
      chapter_viewer: { Args: { _uid: string }; Returns: boolean };
      chapter_room_catalog: {
        Args: never;
        Returns: { id: string; name: string; theme: string | null; capacity: number }[];
      };
      chapter_room_access: { Args: { _uid: string; _room: string }; Returns: boolean };
      chapter_touch_attendance: { Args: { _room: string; _uid: string }; Returns: undefined };
      chapter_request_meeting: {
        Args: {
          _chapter: string;
          _room: string;
          _starts: string;
          _minutes: number;
          _capacity: number;
          _notes?: string | null;
        };
        Returns: string;
      };
      chapter_review_meeting: {
        Args: { _meeting: string; _approve: boolean; _note?: string | null };
        Returns: undefined;
      };
      chapter_cancel_meeting: { Args: { _meeting: string }; Returns: undefined };
      chapter_set_attendee: {
        Args: { _meeting: string; _user: string; _add: boolean };
        Returns: undefined;
      };
      chapter_delete_meeting: { Args: { _meeting: string }; Returns: undefined };
      chapter_save: {
        Args: { _id: string | null; _name: string; _order: number; _active: boolean };
        Returns: string;
      };
      chapter_remove: { Args: { _id: string }; Returns: undefined };
      is_staff: { Args: { _uid: string }; Returns: boolean };
      room_visible: { Args: { _uid: string; _room: string }; Returns: boolean };
      stream_can_host: { Args: { _uid: string }; Returns: boolean };
      stream_viewer_free: { Args: { _uid: string }; Returns: boolean };
      stream_has_ticket: { Args: { _uid: string }; Returns: boolean };
      stream_current_event: { Args: never; Returns: string };
      accept_karaoke_waiver: { Args: { _version: string }; Returns: undefined };
      karaoke_waiver_ok: { Args: { _uid: string }; Returns: boolean };
      set_lifer_grant: { Args: { _uid: string; _granted: boolean }; Returns: undefined };
      search_members: {
        Args: { _q?: string; _limit?: number };
        Returns: {
          id: string;
          username: string;
          avatar_url: string | null;
          wallet_display: string | null;
        }[];
      };
      can_access_area: {
        Args: { _item: string; _uid: string };
        Returns: boolean;
      };
      can_access_chat_channel: { Args: { _channel: string }; Returns: boolean };
      can_use_ape_rides: { Args: { _uid: string }; Returns: boolean };
      get_my_wallet: { Args: never; Returns: string };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      holds_any_collection: {
        Args: { _labels: string; _uid: string };
        Returns: boolean;
      };
      holds_collection: {
        Args: { _label: string; _uid: string };
        Returns: boolean;
      };
      is_admin: { Args: { _user_id: string }; Returns: boolean };
      is_lifer: { Args: { _user_id: string }; Returns: boolean };
      is_room_host: {
        Args: { _room_id: string; _user_id: string };
        Returns: boolean;
      };
      is_token_proof_verified: { Args: { _user_id: string }; Returns: boolean };
      is_verified_holder: { Args: { _user_id: string }; Returns: boolean };
      karaoke_admin_clear_queue: { Args: { _room: string }; Returns: undefined };
      karaoke_admin_create_room: {
        Args: { _capacity?: number; _description?: string; _name: string };
        Returns: string;
      };
      karaoke_admin_delete_room: { Args: { _room: string }; Returns: string };
      karaoke_assert_room: { Args: { _room: string }; Returns: undefined };
      karaoke_book_slot: {
        Args: {
          _backing_track_id?: string;
          _minutes: number;
          _notes?: string;
          _room: string;
          _singer?: string;
          _song_artist?: string;
          _song_title?: string;
          _starts_at: string;
          _video_id?: string;
        };
        Returns: {
          backing_track_id: string | null;
          booked_by: string;
          created_at: string;
          ends_at: string;
          id: string;
          notes: string | null;
          room_id: string;
          singer_user_id: string;
          song_artist: string | null;
          song_title: string | null;
          starts_at: string;
          status: string;
          video_id: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "karaoke_reservations";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      karaoke_booking_host: { Args: { _room: string }; Returns: string };
      karaoke_cancel_reservation: { Args: { _id: string }; Returns: undefined };
      karaoke_claim_stage: {
        Args: { _room: string };
        Returns: {
          backing_track_id: string | null;
          generation: number;
          performer_heartbeat_at: string | null;
          performer_user_id: string | null;
          playback_status: string;
          position_at: string;
          position_ms: number;
          reservation_id: string | null;
          revision: number;
          room_id: string;
          search_query: string | null;
          song_artist: string | null;
          song_title: string | null;
          stage_source: string;
          updated_at: string;
          video_id: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "karaoke_sessions";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      karaoke_control: {
        Args: {
          _action: string;
          _backing_track_id?: string;
          _expected_revision: number;
          _position_ms?: number;
          _room: string;
          _search_query?: string;
          _song_artist?: string;
          _song_title?: string;
          _video_id?: string;
        };
        Returns: {
          backing_track_id: string | null;
          generation: number;
          performer_heartbeat_at: string | null;
          performer_user_id: string | null;
          playback_status: string;
          position_at: string;
          position_ms: number;
          reservation_id: string | null;
          revision: number;
          room_id: string;
          search_query: string | null;
          song_artist: string | null;
          song_title: string | null;
          stage_source: string;
          updated_at: string;
          video_id: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "karaoke_sessions";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      karaoke_end_turn: {
        Args: { _expected_generation?: number; _room: string };
        Returns: {
          backing_track_id: string | null;
          generation: number;
          performer_heartbeat_at: string | null;
          performer_user_id: string | null;
          playback_status: string;
          position_at: string;
          position_ms: number;
          reservation_id: string | null;
          revision: number;
          room_id: string;
          search_query: string | null;
          song_artist: string | null;
          song_title: string | null;
          stage_source: string;
          updated_at: string;
          video_id: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "karaoke_sessions";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      karaoke_entitled_performer: {
        Args: { _room: string };
        Returns: Record<string, unknown>;
      };
      karaoke_heartbeat: {
        Args: { _room: string };
        Returns: {
          backing_track_id: string | null;
          generation: number;
          performer_heartbeat_at: string | null;
          performer_user_id: string | null;
          playback_status: string;
          position_at: string;
          position_ms: number;
          reservation_id: string | null;
          revision: number;
          room_id: string;
          search_query: string | null;
          song_artist: string | null;
          song_title: string | null;
          stage_source: string;
          updated_at: string;
          video_id: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "karaoke_sessions";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      karaoke_is_admin: { Args: { _uid: string }; Returns: boolean };
      karaoke_is_moderator: {
        Args: { _room: string; _uid: string };
        Returns: boolean;
      };
      karaoke_is_sanctioned: {
        Args: { _kind: string; _room: string; _uid: string };
        Returns: boolean;
      };
      karaoke_join_queue: { Args: { _room: string }; Returns: undefined };
      karaoke_leave_queue: { Args: { _room: string }; Returns: undefined };
      karaoke_lock_session: {
        Args: { _room: string };
        Returns: {
          backing_track_id: string | null;
          generation: number;
          performer_heartbeat_at: string | null;
          performer_user_id: string | null;
          playback_status: string;
          position_at: string;
          position_ms: number;
          reservation_id: string | null;
          revision: number;
          room_id: string;
          search_query: string | null;
          song_artist: string | null;
          song_title: string | null;
          stage_source: string;
          updated_at: string;
          video_id: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "karaoke_sessions";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      karaoke_promote_next: { Args: { _room: string }; Returns: string };
      karaoke_server_time: { Args: never; Returns: string };
      karaoke_set_sanction: {
        Args: {
          _active: boolean;
          _kind: string;
          _minutes?: number;
          _reason?: string;
          _room: string;
          _user: string;
        };
        Returns: undefined;
      };
      karaoke_settings: {
        Args: { _room: string };
        Returns: {
          allow_uploads: boolean;
          allow_youtube: boolean;
          booking_window_days: number;
          holders_priority: boolean;
          max_future_bookings: number;
          max_slot_minutes: number;
          max_song_seconds: number;
          recording_enabled: boolean;
          require_booking: boolean;
          room_id: string;
          rules: string;
          updated_at: string;
          updated_by: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "karaoke_room_settings";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      karaoke_update_settings: {
        Args: { _patch: Json; _room: string };
        Returns: {
          allow_uploads: boolean;
          allow_youtube: boolean;
          booking_window_days: number;
          holders_priority: boolean;
          max_future_bookings: number;
          max_slot_minutes: number;
          max_song_seconds: number;
          recording_enabled: boolean;
          require_booking: boolean;
          room_id: string;
          rules: string;
          updated_at: string;
          updated_by: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "karaoke_room_settings";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      log_audit_event: {
        Args: { _event_type: string; _metadata?: Json; _target_id?: string };
        Returns: string;
      };
      mudwater_can_play: {
        Args: { _room: string; _uid: string };
        Returns: boolean;
      };
      mudwater_can_view_match: {
        Args: { _match: string; _uid: string };
        Returns: boolean;
      };
      mudwater_can_watch: { Args: { _uid: string }; Returns: boolean };
      mudwater_commit: {
        Args: {
          _action: Json;
          _expected_version: number;
          _match: string;
          _patch: Json;
          _private: Json;
          _state: Json;
        };
        Returns: boolean;
      };
      mudwater_has_wallet_session: { Args: { _uid: string }; Returns: boolean };
      mudwater_join_seat: {
        Args: {
          _avatar_url: string;
          _display_name: string;
          _match: string;
          _seat?: number;
          _uid: string;
        };
        Returns: number;
      };
      mudwater_leave_waiting: {
        Args: { _match: string; _uid: string };
        Returns: undefined;
      };
      mudwater_open_table: {
        Args: {
          _advanced: boolean;
          _agent_deck: number[];
          _agent_name: string;
          _agent_policy: string;
          _avatar_url: string;
          _catalog_version: string;
          _deck?: number[];
          _display_name: string;
          _mode: string;
          _rematch_of?: string;
          _room: string;
          _rules_version: string;
          _seat?: number;
          _uid: string;
        };
        Returns: string;
      };
      mudwater_set_deck: {
        Args: { _deck: number[]; _match: string; _ready: boolean; _uid: string };
        Returns: undefined;
      };
      mudwater_sweep: { Args: never; Returns: undefined };
      mudwater_touch: {
        Args: { _match: string; _uid: string };
        Returns: undefined;
      };
      my_menu_items: { Args: never; Returns: string[] };
      my_mudwater_access: { Args: never; Returns: boolean };
      purge_expired_auth_nonces: { Args: never; Returns: number };
      show_limit: { Args: never; Returns: number };
      show_trgm: { Args: { "": string }; Returns: string[] };
    };
    Enums: {
      ape_ride_request_status: "pending" | "accepted" | "declined" | "cancelled";
      ape_ride_status: "live" | "ended" | "scheduled" | "cancelled";
      app_role: "super_admin" | "admin" | "verified_user" | "chapter_leader";
      chapter_submission_status: "pending" | "approved" | "rejected";
      room_tier: "token_proof" | "lifer" | "public";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      ape_ride_request_status: ["pending", "accepted", "declined", "cancelled"],
      ape_ride_status: ["live", "ended", "scheduled", "cancelled"],
      app_role: ["super_admin", "admin", "verified_user", "chapter_leader"],
      chapter_submission_status: ["pending", "approved", "rejected"],
      room_tier: ["token_proof", "lifer", "public"],
    },
  },
} as const;

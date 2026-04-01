'use client'

const logos = [
  'logo_01_blob_faces', 'logo_02_emoji_letters', 'logo_03_silhouette_creatures',
  'logo_04_stacked_faces', 'logo_05_tamagotchi_row', 'logo_06_faces_only',
  'logo_07_morph_letters', 'logo_08_minimal_dots', 'logo_09_one_eye_each',
  'logo_10_evolving', 'logo_11_hand_drawn', 'logo_12_negative_space',
  'logo_13_circuit_faces', 'logo_14_shadow_friends', 'logo_15_personality_spectrum',
]

const diagrams = [
  '01_overall_architecture', '02_three_layers', '03_software_first',
  '04_memory_system', '05_device_mesh', '06_settling_personality',
  '07_security_isolation', '08_voice_pipeline', '09_plug_and_play',
  '10_revenue_model', '11_daemon_character', '12_competitive_landscape',
]

const other = ['daemon_logo', 'daemon_logo_v2', 'daemon_logo_v3', 'hero_image']

function ImageGrid({ items, title }: { items: string[]; title: string }) {
  return (
    <>
      <h2 className="text-lg font-medium text-white mt-10 mb-4">{title}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map((name) => (
          <a
            key={name}
            href={`/logos/${name}.png`}
            target="_blank"
            className="block bg-[#1a1a1a] rounded-xl overflow-hidden border border-[#222] hover:border-[#ff0505]/30 transition-colors"
          >
            <img
              src={`/logos/${name}.png`}
              alt={name.replace(/_/g, ' ')}
              className="w-full"
              loading="lazy"
            />
            <div className="px-3 py-2 text-xs text-[#666]">
              {name.replace(/_/g, ' ').replace(/^\d+\s*/, '')}
            </div>
          </a>
        ))}
      </div>
    </>
  )
}

export default function LogosPage() {
  return (
    <div className="min-h-screen bg-[#111] p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-[#ff0505]">daemon</h1>
      <p className="text-sm text-[#555] mt-1 mb-2">Logos & architecture diagrams. Tap to open full size.</p>

      <ImageGrid items={logos} title="Logo Variations" />
      <ImageGrid items={diagrams} title="Architecture Diagrams" />
      <ImageGrid items={other} title="Other" />

      <div className="mt-16 mb-8 text-xs text-[#333]">
        Generated with Nano Banana 2 (Gemini 3.1 Flash Image)
      </div>
    </div>
  )
}

<script lang="ts">
import { Button } from '$lib/components/ui/button';

function openSettings() {
  void browser.runtime.openOptionsPage();
  window.close();
}
</script>

<div class="p-4 space-y-3">
  <h1 class="font-semibold">Acetylcholine</h1>
  <p class="text-sm text-muted-foreground">Hold Shift and hover a word to look it up.</p>
  <Button class="w-full" onclick={openSettings}>Open settings</Button>
</div>

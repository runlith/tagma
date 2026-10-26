<script lang="ts">
  type ReadableList = {
    readonly data: unknown;
    readonly isSuccess: boolean;
    readonly hasNextPage: boolean;
    watch(): unknown;
  };

  type Props = {
    query: ReadableList;
    onRead: (read: { data: unknown; watch: unknown; isSuccess: boolean; hasNextPage: boolean }) => void;
  };

  let { query, onRead }: Props = $props();

  onRead({
    data: query.data,
    watch: query.watch(),
    isSuccess: query.isSuccess,
    hasNextPage: query.hasNextPage,
  });
</script>

<div data-testid="unobserved-inf-read"></div>
